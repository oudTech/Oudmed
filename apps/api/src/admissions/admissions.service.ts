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
import {
  CreateAdmissionDto,
  DischargeAdmissionDto,
  ListAdmissionsQueryDto,
  TransferAdmissionDto,
  UpdateAdmissionDto,
} from './dto/admissions.dto';

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
          bookedById: userId,
        },
        include: ADMISSION_INCLUDE,
      });
      await tx.bed.update({ where: { id: dto.bedId }, data: { status: BedStatus.OCCUPIED } });
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

      if (admission.bedId) {
        await tx.bed.update({ where: { id: admission.bedId }, data: { status: BedStatus.AVAILABLE } });
      }
      await tx.bed.update({ where: { id: newBed.id }, data: { status: BedStatus.OCCUPIED } });
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
      const updated = await tx.admission.update({
        where: { id },
        data: { status, dischargedAt: new Date(), dischargeNotes: dto.dischargeNotes },
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
}
