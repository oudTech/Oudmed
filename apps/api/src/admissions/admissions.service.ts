import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdmissionStatus, BedStatus, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { assertCan, can } from '../common/permissions';
import { nextSequence } from '../common/sequence';
import { BillingService } from '../billing/billing.service';
import { BedChargesService } from './bed-charges.service';
import { UpsertNoteDto, AddNoteAddendumDto } from '../encounters/dto/encounter.dto';
import {
  ApplyDepositDto,
  CreateAdmissionDto,
  CreateDepositDto,
  DischargeAdmissionDto,
  ListAdmissionsQueryDto,
  PayRefundDto,
  RefundDepositDto,
  ReopenAdmissionDto,
  TransferAdmissionDto,
  UpdateAdmissionDto,
} from './dto/admissions.dto';

const D0 = () => new Prisma.Decimal(0);
const min = (a: Prisma.Decimal, b: Prisma.Decimal) => (a.lt(b) ? a : b);
const max = (a: Prisma.Decimal, b: Prisma.Decimal) => (a.gt(b) ? a : b);
// A claim in any of these statuses has nothing more coming from the HMO -
// its remaining unpaid amount (if not written off) has become the
// patient's responsibility, same as any other outstanding balance.
const CLAIM_RESOLVED: string[] = ['PAID', 'REJECTED', 'WRITTEN_OFF', 'CANCELLED'];

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
  ward: { select: { id: true, name: true, dailyRate: true } },
  bed: { select: { id: true, label: true } },
} satisfies Prisma.AdmissionInclude;

const OPEN_BED: BedStatus[] = [BedStatus.AVAILABLE, BedStatus.RESERVED];

@Injectable()
export class AdmissionsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private billing: BillingService,
    private bedCharges: BedChargesService,
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

      // A ward with no rate set cannot accrue bed-day charges (F1b), but that
      // is never a reason to block a real admission (F1 condition 2) - the
      // bed charges simply hold until a rate is set (F1b's daily-charge job
      // catches up on every uncharged night, no lost or doubled charges),
      // and admin/billing are flagged below instead.
      const ward = await tx.ward.findFirst({ where: { id: dto.wardId }, select: { dailyRate: true, name: true } });
      const wardRateMissing = !ward?.dailyRate;

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
        metadata: { admissionNumber: admission.admissionNumber, bedId: dto.bedId, wardRateMissing },
      });
      if (wardRateMissing) {
        await this.audit.record({
          tenantId, userId, action: 'WARD_RATE_MISSING', entityType: 'Admission', entityId: admission.id,
          metadata: { wardId: dto.wardId, wardName: ward?.name ?? null },
        });
      }
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
      const wardRateMissing = !newWard?.dailyRate;

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
        metadata: { from: admission.bedId, to: newBed.id, reason: dto.reason, wardRateMissing },
      });
      if (wardRateMissing) {
        await this.audit.record({
          tenantId, userId, action: 'WARD_RATE_MISSING', entityType: 'Admission', entityId: id,
          metadata: { wardId: newBed.wardId, wardName: newWard?.name ?? null },
        });
      }
      return updated;
    });
  }

  /**
   * Discharge: final bed-charge reconciliation, automatic deposit
   * application against what's owed, the settlement gate/override, and a
   * mandatory refund of any deposit credit left over - then closes the bed
   * and ward-stay. See docs/features/F1-inpatient-billing.md section 8.
   */
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
      const dischargedAt = new Date();

      // Final bed-charge reconciliation (F1b) runs BEFORE the ward-stay row
      // closes below, so "which ward was open at this census instant" still
      // resolves correctly for the very last night/block, and so a same-day
      // stay's short-stay charge can still find its (still-open) ward.
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true, inpatientChargeRule: true, shortStayChargeMode: true,
          requireSettledBillAtDischarge: true,
        },
      });
      await this.bedCharges.postBedCharges(
        tx,
        { id: admission.id, tenantId, patientId: admission.patientId, admittedAt: admission.admittedAt },
        tenant!,
        dischargedAt,
        true,
      );

      // Auto-apply available deposit credit against what's now owed - the
      // one place this happens without a separate staff click, since
      // "settle what's owed from the deposit on hand" is exactly what
      // discharge is supposed to do. Only the balance left after this is
      // subject to the settlement gate below. Capped at the patient-payable
      // portion (correction: never applied against money still expected
      // from an HMO) - see patientPayableBalance().
      const deposits = await tx.admissionDeposit.findMany({ where: { admissionId: id } });
      const owedBeforeApply = await this.patientPayableBalance(tx, { id: admission.id, tenantId });
      const availableDeposit = deposits.reduce(
        (s, d) => s.add(d.amount.sub(d.appliedAmount ?? D0()).sub(d.refundedAmount ?? D0())), D0(),
      );
      const toApply = min(availableDeposit, owedBeforeApply);
      const applyResult = toApply.gt(0)
        ? await this.applyDepositInternal(tx, { id: admission.id, tenantId }, toApply, userId)
        : { applied: D0(), payments: [] as { paymentId: string; receiptNumber: string | null }[] };

      // Gated on the patient's own remaining share, not the whole invoice
      // balance - an HMO portion still awaiting a claim is not something
      // discharge should ever be blocked on.
      const balanceAfterApply = owedBeforeApply.sub(applyResult.applied);
      const depositRemaining = availableDeposit.sub(applyResult.applied);

      if (balanceAfterApply.gt(0) && tenant!.requireSettledBillAtDischarge) {
        if (!dto.overrideReason?.trim()) {
          throw new BadRequestException({
            message: `This admission has an outstanding balance of ${balanceAfterApply.toString()}. Settle it, or discharge anyway with a reason.`,
            code: 'UNSETTLED_BALANCE',
            balance: balanceAfterApply.toString(),
          });
        }
        assertCan(role, 'admission:discharge-unsettled');
        await this.audit.record({
          tenantId, userId, action: 'DISCHARGE_UNSETTLED_OVERRIDE', entityType: 'Admission', entityId: id,
          metadata: { balance: balanceAfterApply.toString(), reason: dto.overrideReason },
        });
      }

      // Any deposit credit left over (deposited more than was owed, or more
      // than the patient's own share while the rest sits with the HMO) is
      // never a reason to block discharge - it is recorded as a pending
      // refund, paid out immediately if refund details were given, or left
      // for billing/cashier to process later from the refunds-due list.
      let refundReceiptNumber: string | null = null;
      let pendingRefundId: string | null = null;
      if (depositRemaining.gt(0)) {
        const refund = await tx.admissionRefund.create({
          data: { tenantId, admissionId: id, amount: depositRemaining, requestedById: userId },
        });
        pendingRefundId = refund.id;
        if (dto.refundMethod?.trim() && can(role, 'admission:deposit-refund')) {
          refundReceiptNumber = await this.payRefundInternal(tx, refund, userId, dto.refundMethod, dto.refundReference);
          pendingRefundId = null;
        }
      }

      if (admission.bedId) {
        await tx.bed.update({ where: { id: admission.bedId }, data: { status: BedStatus.AVAILABLE } });
      }
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
        metadata: {
          depositApplied: applyResult.applied.toString(),
          balanceAfterApply: balanceAfterApply.toString(),
          depositRemaining: depositRemaining.gt(0) ? depositRemaining.toString() : '0',
          refundReceiptNumber,
          pendingRefundId,
        },
      });
      return updated;
    });
  }

  /** Reopens a closed admission for a bounded clinical correction (a late
   * lab result, a note that needs amending) - deliberately does NOT change
   * AdmissionStatus back to ADMITTED, free a bed, or reopen a ward stay (the
   * patient is not physically back in the hospital); it only lifts the
   * closed-admission guard on new clinical entries, the same narrow purpose
   * visit:reopen serves for an outpatient encounter. */
  async reopen({ tenantId, userId, role }: Actor, id: string, dto: ReopenAdmissionDto) {
    assertCan(role, 'admission:reopen');
    return this.prisma.forTenant(tenantId, async (tx) => {
      const admission = await tx.admission.findFirst({ where: { id } });
      if (!admission) throw new NotFoundException('Admission not found');
      if (admission.status === AdmissionStatus.ADMITTED) {
        throw new BadRequestException('Only a closed admission can be reopened');
      }
      if (role === 'DOCTOR' && admission.attendingDoctorId !== userId) {
        throw new ForbiddenException('Only the attending doctor or a Hospital Admin can reopen this admission');
      }

      const updated = await tx.admission.update({
        where: { id },
        data: { reopenedAt: new Date() },
        include: ADMISSION_INCLUDE,
      });

      // Flag any of this admission's invoices that are already locked (paid
      // or claimed) so billing staff see this was reopened, even though new
      // charges will land on a supplementary invoice rather than touching them.
      await this.billing.flagReopenedInvoices(tx, { admissionId: id });

      await this.audit.record({
        tenantId, userId, action: 'ADMISSION_REOPENED', entityType: 'Admission', entityId: id,
        metadata: { reason: dto.reason },
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
   * whatever has been recorded against it so far. Vitals/complaints/
   * diagnoses/prescriptions/orders/notes are all admissionId-capable. */
  async workspace(tenantId: string, id: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const admission = await tx.admission.findFirst({ where: { id }, include: ADMISSION_INCLUDE });
      if (!admission) throw new NotFoundException('Admission not found');

      const [vitals, complaints, diagnoses, prescriptions, orders, notes, deposits, pendingRefunds] = await Promise.all([
        tx.vitalSigns.findMany({ where: { admissionId: id }, orderBy: { recordedAt: 'desc' } }),
        tx.complaint.findMany({ where: { admissionId: id }, orderBy: { recordedAt: 'desc' } }),
        tx.diagnosis.findMany({ where: { admissionId: id }, orderBy: { diagnosedAt: 'desc' } }),
        tx.prescription.findMany({ where: { admissionId: id }, include: { items: true }, orderBy: { prescribedAt: 'desc' } }),
        tx.clinicalOrder.findMany({ where: { admissionId: id }, orderBy: { orderedAt: 'desc' } }),
        tx.clinicalNote.findMany({ where: { admissionId: id }, include: { addenda: true }, orderBy: { createdAt: 'desc' } }),
        tx.admissionDeposit.findMany({ where: { admissionId: id }, orderBy: { receivedAt: 'desc' } }),
        tx.admissionRefund.findMany({ where: { admissionId: id, status: 'PENDING' } }),
      ]);

      const nameMap = await this.names(tx, [
        ...notes.map((n) => n.authorId),
        ...notes.flatMap((n) => n.addenda.map((a) => a.authorId)),
      ]);
      const notesOut = notes.map((n) => ({
        ...n,
        authorName: n.authorId ? nameMap.get(n.authorId) ?? null : null,
        addenda: n.addenda.map((a) => ({ ...a, authorName: a.authorId ? nameMap.get(a.authorId) ?? null : null })),
      }));

      // "Deposit held" is the raw unrefunded/unapplied balance still sitting
      // in the ledger; "pending refund" (shown separately) is the portion of
      // it already earmarked to go back to the patient, no longer available
      // to spend against a new charge (see applyDeposit()/refundDeposit()'s
      // own spendability checks, which do subtract it).
      const pendingRefundTotal = pendingRefunds.reduce((s, r) => s.add(r.amount), D0());
      const totalDeposited = deposits.reduce(
        (s, d) => s.add(d.amount.sub(d.appliedAmount ?? D0()).sub(d.refundedAmount ?? D0())), D0(),
      );

      return {
        admission,
        vitals,
        complaints,
        diagnoses,
        prescriptions,
        orders,
        notes: notesOut,
        deposits: deposits.map((d) => ({
          id: d.id,
          amount: d.amount.toString(),
          method: d.method,
          reference: d.reference,
          receiptNumber: d.receiptNumber,
          receivedAt: d.receivedAt,
          appliedAmount: d.appliedAmount ? d.appliedAmount.toString() : null,
          refundedAmount: d.refundedAmount ? d.refundedAmount.toString() : null,
          refundedAt: d.refundedAt,
          refundReason: d.refundReason,
        })),
        totalDeposited: totalDeposited.toString(),
        pendingRefund: pendingRefundTotal.gt(0) ? pendingRefundTotal.toString() : null,
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

      const [invoices, deposits, pendingRefunds] = await Promise.all([
        tx.invoice.findMany({
          where: { admissionId: id },
          include: { lines: true, payments: true, claim: { select: { id: true, claimNumber: true, status: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        tx.admissionDeposit.findMany({ where: { admissionId: id }, orderBy: { receivedAt: 'desc' } }),
        tx.admissionRefund.findMany({ where: { admissionId: id, status: 'PENDING' } }),
      ]);

      const totalCharged = invoices.reduce((s, i) => s.add(i.totalAmount), D0());
      const totalPaid = invoices.reduce(
        (s, i) => s.add(i.payments.filter((p) => !p.reversedAt).reduce((ps, p) => ps.add(p.amount), D0())),
        D0(),
      );
      const totalDeposited = deposits.reduce(
        (s, d) => s.add(d.amount.sub(d.appliedAmount ?? D0()).sub(d.refundedAmount ?? D0())), D0(),
      );
      const pendingRefundTotal = pendingRefunds.reduce((s, r) => s.add(r.amount), D0());
      // Only the still-spendable deposit (not the portion already earmarked
      // as a pending refund) offsets the balance - that money is committed
      // to go back to the patient, not to cover more of the bill.
      const balance = totalCharged.sub(totalPaid).sub(max(D0(), totalDeposited.sub(pendingRefundTotal)));

      return {
        admission,
        invoices: invoices.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          status: i.status,
          isSupplementary: i.isSupplementary,
          totalAmount: i.totalAmount.toString(),
          lineCount: i.lines.length,
          lines: i.lines.map((l) => ({
            id: l.id,
            category: l.category,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice.toString(),
            lineTotal: l.lineTotal.toString(),
          })),
          claim: i.claim ? { id: i.claim.id, claimNumber: i.claim.claimNumber, status: i.claim.status } : null,
        })),
        deposits: deposits.map((d) => ({
          id: d.id,
          amount: d.amount.toString(),
          method: d.method,
          receiptNumber: d.receiptNumber,
          receivedAt: d.receivedAt,
          appliedAmount: d.appliedAmount ? d.appliedAmount.toString() : null,
          refundedAmount: d.refundedAmount ? d.refundedAmount.toString() : null,
          refundedAt: d.refundedAt,
        })),
        totalCharged: totalCharged.toString(),
        totalPaid: totalPaid.toString(),
        totalDeposited: totalDeposited.toString(),
        pendingRefund: pendingRefundTotal.gt(0) ? pendingRefundTotal.toString() : null,
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

  /** Refund (partial or full) of one named deposit - a narrower permission
   * than taking a deposit, deliberately (separation of duties). Available
   * balance is drawn from the same pool apply-deposit consumes, minus
   * whatever this admission already has earmarked in a pending refund (no
   * double-refunding the same money through the ad-hoc path). */
  async refundDeposit({ tenantId, userId, role }: Actor, id: string, depositId: string, dto: RefundDepositDto) {
    assertCan(role, 'admission:deposit-refund');
    return this.prisma.forTenant(tenantId, async (tx) => {
      const deposit = await tx.admissionDeposit.findFirst({ where: { id: depositId, admissionId: id } });
      if (!deposit) throw new NotFoundException('Deposit not found');
      const alreadyApplied = deposit.appliedAmount ?? D0();
      const alreadyRefunded = deposit.refundedAmount ?? D0();
      const remaining = deposit.amount.sub(alreadyApplied).sub(alreadyRefunded);
      const pending = await tx.admissionRefund.aggregate({
        where: { admissionId: id, status: 'PENDING' }, _sum: { amount: true },
      });
      const effectiveRemaining = max(D0(), remaining.sub(pending._sum.amount ?? D0()));
      if (new Prisma.Decimal(dto.amount).gt(effectiveRemaining)) {
        throw new BadRequestException(`Refund exceeds the remaining deposit balance (${effectiveRemaining.toString()})`);
      }
      const refundReceiptNumber = await this.billing.nextReceiptNumber(tx, tenantId);
      await tx.admissionDeposit.update({
        where: { id: depositId },
        data: {
          refundedAmount: alreadyRefunded.add(dto.amount),
          refundReceiptNumber,
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

  /** The explicit interim-settlement action: converts up to `amount` of
   * available deposit credit into real Payment(s) against the admission's
   * currently unpaid/partial invoices - revenue recognised at exactly the
   * moment it is actually applied, not when the cash first came in. Capped
   * at the patient-payable portion (correction: never applied against money
   * still expected from an HMO) - see patientPayableBalance(). */
  async applyDeposit({ tenantId, userId, role }: Actor, id: string, dto: ApplyDepositDto) {
    assertCan(role, 'billing:manage');
    return this.prisma.forTenant(tenantId, async (tx) => {
      const admission = await tx.admission.findFirst({ where: { id }, select: { id: true } });
      if (!admission) throw new NotFoundException('Admission not found');

      const [owed, deposits, pending] = await Promise.all([
        this.patientPayableBalance(tx, { id, tenantId }),
        tx.admissionDeposit.findMany({ where: { admissionId: id } }),
        tx.admissionRefund.aggregate({ where: { admissionId: id, status: 'PENDING' }, _sum: { amount: true } }),
      ]);
      const available = max(D0(), deposits.reduce(
        (s, d) => s.add(d.amount.sub(d.appliedAmount ?? D0()).sub(d.refundedAmount ?? D0())), D0(),
      ).sub(pending._sum.amount ?? D0()));
      const amount = new Prisma.Decimal(dto.amount);
      if (amount.gt(available)) {
        throw new BadRequestException(`Exceeds available deposit credit (${available.toString()})`);
      }
      if (amount.gt(owed)) {
        throw new BadRequestException(`Exceeds the patient-payable amount owed on this admission (${owed.toString()})`);
      }

      const result = await this.applyDepositInternal(tx, { id, tenantId }, amount, userId);
      await this.audit.record({
        tenantId, userId, action: 'DEPOSIT_APPLIED', entityType: 'Admission', entityId: id,
        metadata: { amount: result.applied.toString(), payments: result.payments },
      });
      return { applied: result.applied.toString(), payments: result.payments };
    });
  }

  /**
   * How much of an admission's outstanding balance is the patient's own
   * responsibility, as opposed to money still expected from an HMO - a
   * deposit must never be applied against the HMO's expected share
   * (correction before F1d). Determined as follows, in order:
   *
   * 1. No outstanding balance at all -> 0, trivially.
   * 2. Not an HMO admission (payerType !== 'HMO') -> the whole balance is
   *    the patient's, exactly as for any cash admission today.
   * 3. An admission claim already exists -> whatever the HMO still has
   *    outstanding on that claim (claimedAmount - paidAmount - writeOffAmount)
   *    is reserved; the rest of the balance is the patient's. Once the claim
   *    reaches a resolved status (PAID/REJECTED/WRITTEN_OFF/CANCELLED),
   *    nothing more is "still expected" - if the HMO rejected part of it and
   *    the hospital does not write that off, it simply becomes patient-
   *    payable balance like any other, exactly as the brief describes
   *    ("the patient portion grows"). This needs no special-casing: it falls
   *    out of the same balance/claim-state read, and a deposit or a fresh
   *    payment can cover it the same way any other balance is covered.
   * 4. No claim yet (the common case pre-F1d, and mid-stay even after) -
   *    estimate the patient's share via the same provider co-pay percentage
   *    `claims.service.ts`'s generate() already uses (patient's own linked
   *    provider, falling back to a name match on hmoName) - the best
   *    estimate available before a real claim exists to measure against.
   */
  private async patientPayableBalance(
    tx: Prisma.TransactionClient,
    admission: { id: string; tenantId: string },
  ): Promise<Prisma.Decimal> {
    const invoices = await tx.invoice.findMany({
      where: { admissionId: admission.id, status: { in: ['UNPAID', 'PARTIAL'] } },
      include: { payments: true },
    });
    const balance = invoices.reduce(
      (s, i) => s.add(i.totalAmount.sub(i.payments.filter((p) => !p.reversedAt).reduce((ps, p) => ps.add(p.amount), D0()))),
      D0(),
    );
    if (balance.lte(0)) return D0();

    const admissionRow = await tx.admission.findFirst({
      where: { id: admission.id },
      select: { payerType: true, hmoName: true, patientId: true },
    });
    if (!admissionRow || admissionRow.payerType !== 'HMO') return balance;

    const claim = await tx.insuranceClaim.findFirst({
      where: { admissionId: admission.id },
      orderBy: { createdAt: 'desc' },
    });
    if (claim) {
      const hmoStillExpected = CLAIM_RESOLVED.includes(claim.status)
        ? D0()
        : max(D0(), claim.claimedAmount.sub(claim.paidAmount).sub(claim.writeOffAmount));
      return max(D0(), balance.sub(hmoStillExpected));
    }

    const patient = await tx.patient.findFirst({
      where: { id: admissionRow.patientId },
      select: { insuranceProviderId: true, hmoName: true, insuranceProvider: true },
    });
    let coPayPct: Prisma.Decimal | null = null;
    if (patient?.insuranceProviderId) {
      const provider = await tx.insuranceProvider.findFirst({
        where: { id: patient.insuranceProviderId },
        select: { defaultCoPayPct: true },
      });
      coPayPct = provider?.defaultCoPayPct ?? null;
    }
    if (coPayPct === null) {
      const nameGuess = admissionRow.hmoName ?? patient?.hmoName ?? patient?.insuranceProvider;
      if (nameGuess) {
        const match = await tx.insuranceProvider.findFirst({
          where: { name: { equals: nameGuess, mode: 'insensitive' }, isActive: true },
          select: { defaultCoPayPct: true },
        });
        coPayPct = match?.defaultCoPayPct ?? null;
      }
    }
    return balance.mul(coPayPct ?? D0()).div(100);
  }

  /** Shared by applyDeposit() and discharge()'s automatic step. Allocates
   * `amount` across the admission's deposits (oldest received first) and,
   * for each chunk, across its unpaid/partial invoices (oldest first),
   * posting one real Payment per (deposit, invoice) pair actually drawn
   * from - same FEFO-style allocation pharmacy stock draw-down already uses,
   * applied here to deposit credit instead of drug batches. */
  private async applyDepositInternal(
    tx: Prisma.TransactionClient,
    admission: { id: string; tenantId: string },
    amount: Prisma.Decimal,
    receivedById: string | null,
  ): Promise<{ applied: Prisma.Decimal; payments: { paymentId: string; receiptNumber: string | null }[] }> {
    if (amount.lte(0)) return { applied: D0(), payments: [] };

    const deposits = await tx.admissionDeposit.findMany({
      where: { admissionId: admission.id }, orderBy: { receivedAt: 'asc' },
    });
    const invoices = await tx.invoice.findMany({
      where: { admissionId: admission.id, status: { in: ['UNPAID', 'PARTIAL'] } },
      include: { payments: true },
      orderBy: { createdAt: 'asc' },
    });
    const invoiceBalances = invoices.map((i) => ({
      id: i.id,
      balance: i.totalAmount.sub(i.payments.filter((p) => !p.reversedAt).reduce((s, p) => s.add(p.amount), D0())),
    }));

    let remaining = amount;
    const payments: { paymentId: string; receiptNumber: string | null }[] = [];

    for (const dep of deposits) {
      if (remaining.lte(0)) break;
      const appliedSoFar = dep.appliedAmount ?? D0();
      const available = dep.amount.sub(appliedSoFar).sub(dep.refundedAmount ?? D0());
      if (available.lte(0)) continue;
      let fromThisDeposit = min(available, remaining);
      let consumedFromThisDeposit = D0();

      for (const inv of invoiceBalances) {
        if (fromThisDeposit.lte(0)) break;
        if (inv.balance.lte(0)) continue;
        const chunk = min(inv.balance, fromThisDeposit);
        if (chunk.lte(0)) continue;
        const { paymentId, receiptNumber } = await this.billing.postPaymentTx(tx, {
          tenantId: admission.tenantId, invoiceId: inv.id, amount: chunk, method: dep.method as PaymentMethod,
          note: `Applied from deposit ${dep.receiptNumber ?? dep.id}`, receivedById,
        });
        payments.push({ paymentId, receiptNumber });
        inv.balance = inv.balance.sub(chunk);
        fromThisDeposit = fromThisDeposit.sub(chunk);
        consumedFromThisDeposit = consumedFromThisDeposit.add(chunk);
        remaining = remaining.sub(chunk);
      }

      if (consumedFromThisDeposit.gt(0)) {
        await tx.admissionDeposit.update({
          where: { id: dep.id },
          data: { appliedAmount: appliedSoFar.add(consumedFromThisDeposit) },
        });
      }
    }
    return { applied: amount.sub(remaining), payments };
  }

  /** Refunds `amount` across the admission's deposits (oldest first), all
   * under one refund receipt - the mechanics behind both an immediate
   * refund-at-discharge and paying out a pending AdmissionRefund later. */
  private async refundDepositsInternal(
    tx: Prisma.TransactionClient,
    admission: { id: string; tenantId: string },
    amount: Prisma.Decimal,
    userId: string,
    reasonLabel: string,
  ): Promise<string> {
    const refundReceiptNumber = await this.billing.nextReceiptNumber(tx, admission.tenantId);
    const deposits = await tx.admissionDeposit.findMany({
      where: { admissionId: admission.id }, orderBy: { receivedAt: 'asc' },
    });
    let remaining = amount;
    for (const dep of deposits) {
      if (remaining.lte(0)) break;
      const alreadyApplied = dep.appliedAmount ?? D0();
      const alreadyRefunded = dep.refundedAmount ?? D0();
      const available = dep.amount.sub(alreadyApplied).sub(alreadyRefunded);
      if (available.lte(0)) continue;
      const chunk = min(available, remaining);
      await tx.admissionDeposit.update({
        where: { id: dep.id },
        data: {
          refundedAmount: alreadyRefunded.add(chunk),
          refundReceiptNumber,
          refundedAt: new Date(),
          refundedById: userId,
          refundReason: reasonLabel,
        },
      });
      remaining = remaining.sub(chunk);
    }
    return refundReceiptNumber;
  }

  /** Pays out a pending refund immediately - shared by discharge() (when
   * refund details are given inline) and the explicit pay-later endpoint. */
  private async payRefundInternal(
    tx: Prisma.TransactionClient,
    refund: { id: string; admissionId: string; tenantId: string; amount: Prisma.Decimal },
    userId: string,
    method: string,
    reference: string | undefined,
  ): Promise<string> {
    const refundReceiptNumber = await this.refundDepositsInternal(
      tx, { id: refund.admissionId, tenantId: refund.tenantId }, refund.amount, userId,
      `Refund paid out (reference: ${reference ?? method})`,
    );
    await tx.admissionRefund.update({
      where: { id: refund.id },
      data: { status: 'PAID', paidAt: new Date(), paidById: userId, method, reference, receiptNumber: refundReceiptNumber },
    });
    return refundReceiptNumber;
  }

  /** Pays out a pending refund recorded at discharge (or otherwise) -
   * narrower permission than taking a deposit, same as an ad-hoc refund. */
  async payRefund({ tenantId, userId, role }: Actor, id: string, refundId: string, dto: PayRefundDto) {
    assertCan(role, 'admission:deposit-refund');
    return this.prisma.forTenant(tenantId, async (tx) => {
      const refund = await tx.admissionRefund.findFirst({ where: { id: refundId, admissionId: id } });
      if (!refund) throw new NotFoundException('Refund not found');
      if (refund.status === 'PAID') {
        throw new BadRequestException('This refund has already been paid');
      }
      const receiptNumber = await this.payRefundInternal(
        tx, { id: refund.id, admissionId: id, tenantId, amount: refund.amount }, userId, dto.method, dto.reference,
      );
      await this.audit.record({
        tenantId, userId, action: 'REFUND_PAID', entityType: 'Admission', entityId: id,
        metadata: { refundId, amount: refund.amount.toString(), receiptNumber },
      });
      return { ok: true, receiptNumber };
    });
  }

  /** The tenant-wide "refunds due" list for billing/cashier - every pending
   * deposit refund across every admission, oldest first. */
  async listPendingRefunds(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const refunds = await tx.admissionRefund.findMany({
        where: { status: 'PENDING' },
        include: {
          admission: {
            select: {
              id: true, admissionNumber: true,
              patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { requestedAt: 'asc' },
      });
      return refunds.map((r) => ({
        id: r.id,
        amount: r.amount.toString(),
        reason: r.reason,
        requestedAt: r.requestedAt,
        admissionId: r.admission.id,
        admissionNumber: r.admission.admissionNumber,
        patient: {
          id: r.admission.patient.id,
          patientNumber: r.admission.patient.patientNumber,
          name: `${r.admission.patient.firstName} ${r.admission.patient.lastName}`.trim(),
        },
      }));
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
        receiptNumber: deposit.refundedAt ? deposit.refundReceiptNumber : deposit.receiptNumber,
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

  // ─────────────────────────── admission notes (F1c) ───────────────────────────

  /** A new, dated ward-round note - always a new row, never an upsert
   * (unlike a visit's single SOAP note): an admission spans many rounds,
   * each with its own author and timestamp. Blocked once closed, unless
   * reopened (admission:reopen) - same guard shape as orders/prescriptions. */
  async addNote({ tenantId, userId, role }: Actor, id: string, dto: UpsertNoteDto) {
    assertCan(role, 'note:write');
    return this.prisma.forTenant(tenantId, async (tx) => {
      const admission = await tx.admission.findFirst({
        where: { id }, select: { id: true, patientId: true, status: true, reopenedAt: true },
      });
      if (!admission) throw new NotFoundException('Admission not found');
      if (admission.status !== AdmissionStatus.ADMITTED && !admission.reopenedAt) {
        throw new BadRequestException({
          message: 'This admission is closed. Reopen it to add a note.',
          code: 'ADMISSION_CLOSED',
        });
      }
      const row = await tx.clinicalNote.create({
        data: {
          tenantId, patientId: admission.patientId, admissionId: id,
          subjective: dto.subjective, objective: dto.objective, assessment: dto.assessment, plan: dto.plan,
          authorId: userId,
        },
      });
      await this.audit.record({
        tenantId, userId, action: 'SAVE_NOTE', entityType: 'Admission', entityId: id,
        metadata: { noteId: row.id },
      });
      return row;
    });
  }

  /** A late correction to one specific dated note, after the admission was
   * already closed (addNote itself is blocked once closed, unless
   * reopened). Never blocked by completion - the same append-only shape
   * FUNC-2 already gives a visit's note. */
  async addNoteAddendum({ tenantId, userId, role }: Actor, id: string, noteId: string, dto: AddNoteAddendumDto) {
    assertCan(role, 'note:write');
    if (!dto.subjective && !dto.objective && !dto.assessment && !dto.plan) {
      throw new BadRequestException('An addendum needs at least one field filled in');
    }
    return this.prisma.forTenant(tenantId, async (tx) => {
      const note = await tx.clinicalNote.findFirst({ where: { id: noteId, admissionId: id } });
      if (!note) throw new NotFoundException('Note not found');
      const row = await tx.clinicalNoteAddendum.create({
        data: {
          tenantId, patientId: note.patientId, admissionId: id, noteId,
          subjective: dto.subjective, objective: dto.objective, assessment: dto.assessment, plan: dto.plan,
          authorId: userId,
        },
      });
      await this.audit.record({
        tenantId, userId, action: 'ADD_NOTE_ADDENDUM', entityType: 'Admission', entityId: id,
        metadata: { noteId, addendumId: row.id },
      });
      return row;
    });
  }

  /** A printable discharge summary, assembled entirely from what was already
   * recorded during the stay - no new data collected. */
  async dischargeSummary(tenantId: string, id: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const admission = await tx.admission.findFirst({ where: { id }, include: ADMISSION_INCLUDE });
      if (!admission) throw new NotFoundException('Admission not found');

      const [diagnoses, prescriptions, notes, invoices, deposits, pendingRefunds] = await Promise.all([
        tx.diagnosis.findMany({ where: { admissionId: id }, orderBy: { diagnosedAt: 'asc' } }),
        tx.prescription.findMany({ where: { admissionId: id }, include: { items: true }, orderBy: { prescribedAt: 'asc' } }),
        tx.clinicalNote.findMany({ where: { admissionId: id }, orderBy: { createdAt: 'asc' } }),
        tx.invoice.findMany({ where: { admissionId: id }, include: { payments: true } }),
        tx.admissionDeposit.findMany({ where: { admissionId: id } }),
        tx.admissionRefund.findMany({ where: { admissionId: id } }),
      ]);

      const totalCharged = invoices.reduce((s, i) => s.add(i.totalAmount), D0());
      const totalPaid = invoices.reduce(
        (s, i) => s.add(i.payments.filter((p) => !p.reversedAt).reduce((ps, p) => ps.add(p.amount), D0())),
        D0(),
      );
      const totalDeposited = deposits.reduce(
        (s, d) => s.add(d.amount.sub(d.appliedAmount ?? D0()).sub(d.refundedAmount ?? D0())), D0(),
      );
      const pendingRefundTotal = pendingRefunds.filter((r) => r.status === 'PENDING').reduce((s, r) => s.add(r.amount), D0());
      const balance = totalCharged.sub(totalPaid).sub(max(D0(), totalDeposited.sub(pendingRefundTotal)));

      return {
        admission,
        diagnoses,
        prescriptions,
        notes,
        totalCharged: totalCharged.toString(),
        totalPaid: totalPaid.toString(),
        totalDeposited: totalDeposited.toString(),
        pendingRefund: pendingRefundTotal.gt(0) ? pendingRefundTotal.toString() : null,
        balance: balance.toString(),
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
