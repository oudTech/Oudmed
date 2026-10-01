import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdmissionStatus, BedStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { assertCan } from '../common/permissions';
import { nextSequence } from '../common/sequence';
import { BillingService } from '../billing/billing.service';
import {
  CreateAdmissionDto,
  CreateDepositDto,
  DischargeAdmissionDto,
  ListAdmissionsQueryDto,
  RefundDepositDto,
  TransferAdmissionDto,
  UpdateAdmissionDto,
} from './dto/admissions.dto';

const D0 = () => new Prisma.Decimal(0);

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

const ADMISSION_INCLUDE = {
  patient: {
    select: {
      id: true, patientNumber: true, firstName: true, lastName: true,
      phone: true, gender: true, payerType: true, hmoName: true,
    },
  },
  admittingDoctor: { select: { id: true, fullName: true } },
  attendingDoctor: { select: { id: true, fullName: true } },
  department: { select: { id: true, name: true } },
  ward: { select: { id: true, name: true } },
  bed: { select: { id: true, label: true } },
} satisfies Prisma.AdmissionInclude;

const OPEN_BED: BedStatus[] = [BedStatus.AVAILABLE, BedStatus.RESERVED];

@Injectable()
export class AdmissionsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private billing: BillingService,
  ) {}

  async list(tenantId: string, q: ListAdmissionsQueryDto) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.admission.findMany({
        where: {
          status: q.status ?? AdmissionStatus.ADMITTED,
          ...(q.wardId ? { wardId: q.wardId } : {}),
        },
        include: ADMISSION_INCLUDE,
        orderBy: { admittedAt: 'desc' },
      }),
    );
  }

  async getOne(tenantId: string, id: string) {
    const admission = await this.prisma.forTenant(tenantId, (tx) =>
      tx.admission.findFirst({ where: { id }, include: ADMISSION_INCLUDE }),
    );
    if (!admission) throw new NotFoundException('Admission not found');
    return admission;
  }

  private async nextAdmissionNumber(tx: Prisma.TransactionClient, tenantId: string) {
    const n = await nextSequence(tx, tenantId, 'admission', () =>
      tx.admission.count({ where: { tenantId } }),
    );
    return `ADM-${String(n).padStart(6, '0')}`;
  }

  async admit({ tenantId, userId, role }: Actor, dto: CreateAdmissionDto) {
    assertCan(role, 'admission:create');
    return this.prisma.forTenant(tenantId, async (tx) => {
      const patient = await tx.patient.findFirst({ where: { id: dto.patientId } });
      if (!patient) throw new NotFoundException('Patient not found');

      const activePatientAdmission = await tx.admission.findFirst({
        where: { patientId: dto.patientId, status: AdmissionStatus.ADMITTED },
      });
      if (activePatientAdmission) {
        throw new ConflictException({
          message: 'This patient is already admitted',
          code: 'PATIENT_ALREADY_ADMITTED',
        });
      }

      const bed = await tx.bed.findFirst({ where: { id: dto.bedId, wardId: dto.wardId } });
      if (!bed) throw new BadRequestException('That bed does not belong to the selected ward');
      if (!OPEN_BED.includes(bed.status)) {
        throw new ConflictException({ message: 'That bed is not available', code: 'BED_UNAVAILABLE' });
      }

      // A ward with no rate set cannot accrue bed-day charges at all (F1b) -
      // failing loudly here, at admission time, beats discovering it silently
      // at the first missed night.
      const ward = await tx.ward.findFirst({ where: { id: dto.wardId }, select: { dailyRate: true, name: true } });
      if (!ward?.dailyRate) {
        throw new BadRequestException(`Ward "${ward?.name ?? dto.wardId}" has no daily rate set - ask an admin to set one before admitting into it`);
      }

      const admittedAt = new Date();
      const admission = await tx.admission.create({
        data: {
          tenantId,
          admissionNumber: await this.nextAdmissionNumber(tx, tenantId),
          patientId: dto.patientId,
          admittingDoctorId: dto.admittingDoctorId ?? null,
          attendingDoctorId: dto.attendingDoctorId ?? dto.admittingDoctorId ?? null,
          departmentId: dto.departmentId ?? null,
          wardId: dto.wardId,
          bedId: dto.bedId,
          admissionType: dto.admissionType,
          reason: dto.reason,
          provisionalDiagnosis: dto.provisionalDiagnosis,
          payerType: dto.payerType ?? patient.payerType,
          hmoName: dto.hmoName ?? patient.hmoName,
          authCode: dto.authCode,
          expectedDischargeAt: dto.expectedDischargeAt ? new Date(dto.expectedDischargeAt) : null,
          originatingVisitId: dto.originatingVisitId ?? null,
          admittedAt,
          bookedById: userId,
        },
        include: ADMISSION_INCLUDE,
      });
      await tx.bed.update({ where: { id: dto.bedId }, data: { status: BedStatus.OCCUPIED } });
      await tx.admissionWardStay.create({
        data: {
          tenantId, admissionId: admission.id, wardId: dto.wardId, bedId: dto.bedId,
          startedAt: admittedAt,
        },
      });
      await this.audit.record({
        tenantId, userId, action: 'ADMIT', entityType: 'Admission', entityId: admission.id,
        metadata: { admissionNumber: admission.admissionNumber, bedId: dto.bedId },
      });
      return admission;
    });
  }

  async transfer({ tenantId, userId, role }: Actor, id: string, dto: TransferAdmissionDto) {
    assertCan(role, 'admission:transfer');
    return this.prisma.forTenant(tenantId, async (tx) => {
      const admission = await tx.admission.findFirst({ where: { id } });
      if (!admission) throw new NotFoundException('Admission not found');
      if (admission.status !== AdmissionStatus.ADMITTED) {
        throw new BadRequestException('Only an active admission can be transferred');
      }
      const newBed = await tx.bed.findFirst({ where: { id: dto.bedId } });
      if (!newBed) throw new BadRequestException('Bed not found');
      if (newBed.id === admission.bedId) throw new BadRequestException('Patient is already in that bed');
      if (!OPEN_BED.includes(newBed.status)) {
        throw new ConflictException({ message: 'That bed is not available', code: 'BED_UNAVAILABLE' });
      }
      const newWard = await tx.ward.findFirst({ where: { id: newBed.wardId }, select: { dailyRate: true, name: true } });
      if (!newWard?.dailyRate) {
        throw new BadRequestException(`Ward "${newWard?.name ?? newBed.wardId}" has no daily rate set - ask an admin to set one before transferring into it`);
      }

      if (admission.bedId) {
        await tx.bed.update({ where: { id: admission.bedId }, data: { status: BedStatus.AVAILABLE } });
      }
      await tx.bed.update({ where: { id: newBed.id }, data: { status: BedStatus.OCCUPIED } });
      const now = new Date();
      // Close the open ward-stay row and open a new one - F1b's day-charging
      // logic attributes a night's charge to whichever row was open at the
      // census instant, so exactly one row must ever be open at a time.
      await tx.admissionWardStay.updateMany({
        where: { admissionId: id, endedAt: null },
        data: { endedAt: now },
      });
      await tx.admissionWardStay.create({
        data: { tenantId, admissionId: id, wardId: newBed.wardId, bedId: newBed.id, startedAt: now },
      });
      const updated = await tx.admission.update({
        where: { id },
        data: { bedId: newBed.id, wardId: newBed.wardId },
        include: ADMISSION_INCLUDE,
      });
      await this.audit.record({
        tenantId, userId, action: 'TRANSFER', entityType: 'Admission', entityId: id,
        metadata: { from: admission.bedId, to: newBed.id, reason: dto.reason },
      });
      return updated;
    });
  }

  async discharge({ tenantId, userId, role }: Actor, id: string, dto: DischargeAdmissionDto) {
    assertCan(role, 'admission:discharge');
    const status = dto.status ?? AdmissionStatus.DISCHARGED;
    if (status === AdmissionStatus.ADMITTED) {
      throw new BadRequestException('Pick a discharge outcome');
    }
    return this.prisma.forTenant(tenantId, async (tx) => {
      const admission = await tx.admission.findFirst({ where: { id } });
      if (!admission) throw new NotFoundException('Admission not found');
      if (admission.status !== AdmissionStatus.ADMITTED) {
        throw new BadRequestException('This admission is already closed');
      }
      if (admission.bedId) {
        await tx.bed.update({ where: { id: admission.bedId }, data: { status: BedStatus.AVAILABLE } });
      }
      const dischargedAt = new Date();
      await tx.admissionWardStay.updateMany({
        where: { admissionId: id, endedAt: null },
        data: { endedAt: dischargedAt },
      });
      const updated = await tx.admission.update({
        where: { id },
        data: { status, dischargedAt, dischargeNotes: dto.dischargeNotes },
        include: ADMISSION_INCLUDE,
      });
      await this.audit.record({
        tenantId, userId, action: `DISCHARGE_${status}`, entityType: 'Admission', entityId: id,
      });
      return updated;
    });
  }

  async update({ tenantId, userId, role }: Actor, id: string, dto: UpdateAdmissionDto) {
    assertCan(role, 'admission:edit');
    return this.prisma.forTenant(tenantId, async (tx) => {
      const admission = await tx.admission.findFirst({ where: { id } });
      if (!admission) throw new NotFoundException('Admission not found');
      const updated = await tx.admission.update({
        where: { id },
        data: {
          attendingDoctorId: dto.attendingDoctorId ?? undefined,
          departmentId: dto.departmentId ?? undefined,
          provisionalDiagnosis: dto.provisionalDiagnosis ?? undefined,
          payerType: dto.payerType ?? undefined,
          hmoName: dto.hmoName ?? undefined,
          authCode: dto.authCode ?? undefined,
          expectedDischargeAt: dto.expectedDischargeAt ? new Date(dto.expectedDischargeAt) : undefined,
        },
        include: ADMISSION_INCLUDE,
      });
      await this.audit.record({ tenantId, userId, action: 'UPDATE', entityType: 'Admission', entityId: id });
      return updated;
    });
  }

  // ─────────────────────────── inpatient workspace (F1a basics) ───────────────────────────

  /** Everything a ward-round screen needs for one admission: header info plus
   * whatever has been recorded against it so far. Vitals/complaints/diagnoses/
   * prescriptions are already admissionId-capable (schema + DTOs); orders and
   * notes against an admission are F1b work, alongside the charge-posting
   * they also need. */
  async workspace(tenantId: string, id: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const admission = await tx.admission.findFirst({ where: { id }, include: ADMISSION_INCLUDE });
      if (!admission) throw new NotFoundException('Admission not found');

      const [vitals, complaints, diagnoses, prescriptions, deposits] = await Promise.all([
        tx.vitalSigns.findMany({ where: { admissionId: id }, orderBy: { recordedAt: 'desc' } }),
        tx.complaint.findMany({ where: { admissionId: id }, orderBy: { recordedAt: 'desc' } }),
        tx.diagnosis.findMany({ where: { admissionId: id }, orderBy: { diagnosedAt: 'desc' } }),
        tx.prescription.findMany({ where: { admissionId: id }, include: { items: true }, orderBy: { prescribedAt: 'desc' } }),
        tx.admissionDeposit.findMany({ where: { admissionId: id }, orderBy: { receivedAt: 'desc' } }),
      ]);

      const totalDeposited = deposits.reduce(
        (s, d) => s.add(d.amount.sub(d.refundedAmount ?? D0())), D0(),
      );

      return {
        admission,
        vitals,
        complaints,
        diagnoses,
        prescriptions,
        deposits: deposits.map((d) => ({
          id: d.id,
          amount: d.amount.toString(),
          method: d.method,
          reference: d.reference,
          receiptNumber: d.receiptNumber,
          receivedAt: d.receivedAt,
          refundedAmount: d.refundedAmount ? d.refundedAmount.toString() : null,
          refundedAt: d.refundedAt,
          refundReason: d.refundReason,
        })),
        totalDeposited: totalDeposited.toString(),
      };
    });
  }

  /** The admission-level running-bill view (F1 design doc section 5): charged
   * minus paid minus unapplied deposit credit, assembled across every invoice
   * for this admission. Daily bed-charges (F1b) simply add more invoice lines
   * for this same computation to pick up - nothing here needs to change when
   * that lands. */
  async bill(tenantId: string, id: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const admission = await tx.admission.findFirst({ where: { id }, include: ADMISSION_INCLUDE });
      if (!admission) throw new NotFoundException('Admission not found');

      const [invoices, deposits] = await Promise.all([
        tx.invoice.findMany({
          where: { admissionId: id },
          include: { lines: true, payments: true, claim: { select: { id: true, claimNumber: true, status: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        tx.admissionDeposit.findMany({ where: { admissionId: id }, orderBy: { receivedAt: 'desc' } }),
      ]);

      const totalCharged = invoices.reduce((s, i) => s.add(i.totalAmount), D0());
      const totalPaid = invoices.reduce(
        (s, i) => s.add(i.payments.filter((p) => !p.reversedAt).reduce((ps, p) => ps.add(p.amount), D0())),
        D0(),
      );
      const totalDeposited = deposits.reduce((s, d) => s.add(d.amount.sub(d.refundedAmount ?? D0())), D0());
      const balance = totalCharged.sub(totalPaid).sub(totalDeposited);

      return {
        admission,
        invoices: invoices.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          status: i.status,
          isSupplementary: i.isSupplementary,
          totalAmount: i.totalAmount.toString(),
          lineCount: i.lines.length,
          claim: i.claim ? { id: i.claim.id, claimNumber: i.claim.claimNumber, status: i.claim.status } : null,
        })),
        deposits: deposits.map((d) => ({
          id: d.id,
          amount: d.amount.toString(),
          method: d.method,
          receiptNumber: d.receiptNumber,
          receivedAt: d.receivedAt,
          refundedAmount: d.refundedAmount ? d.refundedAmount.toString() : null,
          refundedAt: d.refundedAt,
        })),
        totalCharged: totalCharged.toString(),
        totalPaid: totalPaid.toString(),
        totalDeposited: totalDeposited.toString(),
        balance: balance.toString(),
      };
    });
  }

  /** Record a deposit or a top-up - never a Payment (see
   * docs/features/F1-inpatient-billing.md section 5 for why). Draws a
   * receipt number from the exact same sequence a Payment receipt uses. */
  async addDeposit({ tenantId, userId, role }: Actor, id: string, dto: CreateDepositDto) {
    assertCan(role, 'admission:deposit');
    return this.prisma.forTenant(tenantId, async (tx) => {
      const admission = await tx.admission.findFirst({ where: { id }, select: { id: true } });
      if (!admission) throw new NotFoundException('Admission not found');
      const receiptNumber = await this.billing.nextReceiptNumber(tx, tenantId);
      const deposit = await tx.admissionDeposit.create({
        data: {
          tenantId, admissionId: id, amount: dto.amount, method: dto.method,
          reference: dto.reference, receiptNumber, receivedById: userId,
        },
      });
      await this.audit.record({
        tenantId, userId, action: 'DEPOSIT', entityType: 'Admission', entityId: id,
        metadata: { depositId: deposit.id, amount: dto.amount, method: dto.method, receiptNumber },
      });
      return { id: deposit.id, receiptNumber };
    });
  }

  /** Refund (partial or full) of one deposit - a narrower permission than
   * taking a deposit, deliberately (separation of duties). */
  async refundDeposit({ tenantId, userId, role }: Actor, id: string, depositId: string, dto: RefundDepositDto) {
    assertCan(role, 'admission:deposit-refund');
    return this.prisma.forTenant(tenantId, async (tx) => {
      const deposit = await tx.admissionDeposit.findFirst({ where: { id: depositId, admissionId: id } });
      if (!deposit) throw new NotFoundException('Deposit not found');
      const already = deposit.refundedAmount ?? D0();
      const remaining = deposit.amount.sub(already);
      if (new Prisma.Decimal(dto.amount).gt(remaining)) {
        throw new BadRequestException(`Refund exceeds the remaining deposit balance (${remaining.toString()})`);
      }
      const refundReceiptNumber = await this.billing.nextReceiptNumber(tx, tenantId);
      await tx.admissionDeposit.update({
        where: { id: depositId },
        data: {
          refundedAmount: already.add(dto.amount),
          refundedAt: new Date(),
          refundedById: userId,
          refundReason: dto.reason,
        },
      });
      await this.audit.record({
        tenantId, userId, action: 'DEPOSIT_REFUND', entityType: 'Admission', entityId: id,
        metadata: { depositId, amount: dto.amount, reason: dto.reason, refundReceiptNumber },
      });
      return { ok: true, refundReceiptNumber };
    });
  }

  /** A printable receipt for one deposit or refund - headed differently for
   * each so cash reconciliation never mistakes one for the other. */
  async depositReceipt(tenantId: string, id: string, depositId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const deposit = await tx.admissionDeposit.findFirst({
        where: { id: depositId, admissionId: id },
        include: { admission: { include: { patient: { select: { firstName: true, lastName: true, patientNumber: true } } } } },
      });
      if (!deposit) throw new NotFoundException('Deposit not found');
      const names = await this.names(tx, [deposit.receivedById, deposit.refundedById]);
      return {
        isRefund: !!deposit.refundedAt,
        receiptNumber: deposit.refundedAt ? deposit.receiptNumber : deposit.receiptNumber,
        amount: deposit.refundedAt ? (deposit.refundedAmount ?? D0()).toString() : deposit.amount.toString(),
        method: deposit.method,
        reference: deposit.reference,
        date: deposit.refundedAt ?? deposit.receivedAt,
        receivedByName: deposit.receivedById ? names.get(deposit.receivedById) ?? null : null,
        refundedByName: deposit.refundedById ? names.get(deposit.refundedById) ?? null : null,
        refundReason: deposit.refundReason,
        admissionNumber: deposit.admission.admissionNumber,
        patient: {
          name: `${deposit.admission.patient.firstName} ${deposit.admission.patient.lastName}`.trim(),
          patientNumber: deposit.admission.patient.patientNumber,
        },
      };
    });
  }

  private async names(tx: Prisma.TransactionClient, ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }
}
