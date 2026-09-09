import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { FilesService } from '../storage/files.service';
import { assertCan, can } from '../common/permissions';
import { nextSequence } from '../common/sequence';
import {
  CheckDuplicatesDto,
  CreatePatientDto,
  ListPatientsQueryDto,
  UpdatePatientDto,
} from './dto/patient.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

const PAGE_SIZE = 25;
const OPEN_VISIT: Prisma.VisitWhereInput['status'] = {
  in: ['SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS'],
};

function ageFrom(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

@Injectable()
export class PatientsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private files: FilesService,
  ) {}

  private async nextPatientNumber(tx: Prisma.TransactionClient, tenantId: string) {
    const n = await nextSequence(tx, tenantId, 'patient', () =>
      tx.patient.count({ where: { tenantId } }),
    );
    return `PT-${String(n).padStart(5, '0')}`;
  }

  // ─────────────────────────── list ───────────────────────────

  async list(actor: Actor, q: ListPatientsQueryDto) {
    assertCan(actor.role, 'patient:read');
    const { tenantId } = actor;
    const page = q.page && q.page > 0 ? q.page : 1;
    return this.prisma.forTenant(tenantId, async (tx) => {
      const openAdms = await tx.admission.findMany({
        where: { status: 'ADMITTED' },
        select: { patientId: true, admissionType: true },
      });
      const inpatientIds = new Set(openAdms.map((a) => a.patientId));
      const emergencyIds = new Set(
        openAdms.filter((a) => a.admissionType === 'EMERGENCY').map((a) => a.patientId),
      );
      const emVisits = await tx.visit.findMany({
        where: { visitType: 'EMERGENCY', status: OPEN_VISIT },
        select: { patientId: true },
      });
      emVisits.forEach((v) => emergencyIds.add(v.patientId));

      const where: Prisma.PatientWhereInput = {};
      if (q.search) {
        where.OR = [
          { firstName: { contains: q.search, mode: 'insensitive' } },
          { middleName: { contains: q.search, mode: 'insensitive' } },
          { lastName: { contains: q.search, mode: 'insensitive' } },
          { phone: { contains: q.search } },
          { patientNumber: { contains: q.search, mode: 'insensitive' } },
          { hmoNumber: { contains: q.search, mode: 'insensitive' } },
        ];
      }
      if (q.gender) where.gender = { equals: q.gender, mode: 'insensitive' };

      switch (q.filter) {
        case 'hmo':
          where.payerType = 'HMO';
          break;
        case 'incomplete':
          where.registrationStatus = 'INCOMPLETE';
          break;
        case 'inpatient':
          where.id = { in: [...inpatientIds] };
          break;
        case 'emergency':
          where.id = { in: [...emergencyIds] };
          break;
        case 'active':
          where.isActive = true;
          where.id = { notIn: [...inpatientIds] };
          break;
        default:
          where.isActive = true;
      }

      const [total, rows] = await Promise.all([
        tx.patient.count({ where }),
        tx.patient.findMany({
          where,
          include: { assignedDoctor: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      const ids = rows.map((r) => r.id);
      const lastVisits = ids.length
        ? await tx.visit.findMany({
            where: { patientId: { in: ids } },
            orderBy: { startsAt: 'desc' },
            distinct: ['patientId'],
            select: { patientId: true, startsAt: true },
          })
        : [];
      const lastVisitMap = new Map(lastVisits.map((v) => [v.patientId, v.startsAt]));

      return {
        page,
        pageSize: PAGE_SIZE,
        total,
        patients: rows.map((p) => ({
          id: p.id,
          patientNumber: p.patientNumber,
          firstName: p.firstName,
          middleName: p.middleName,
          lastName: p.lastName,
          gender: p.gender,
          phone: p.phone,
          age: ageFrom(p.dateOfBirth),
          payerType: p.payerType,
          hmoName: p.hmoName,
          registrationStatus: p.registrationStatus,
          assignedDoctor: p.assignedDoctor,
          lastVisitAt: lastVisitMap.get(p.id) ?? null,
          status: inpatientIds.has(p.id)
            ? 'INPATIENT'
            : p.registrationStatus === 'INCOMPLETE'
              ? 'INCOMPLETE'
              : 'ACTIVE',
        })),
      };
    });
  }

  async stats(actor: Actor) {
    assertCan(actor.role, 'patient:read');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const openAdms = await tx.admission.findMany({
        where: { status: 'ADMITTED' },
        select: { patientId: true, admissionType: true, admittedAt: true },
      });
      const inpatientIds = new Set(openAdms.map((a) => a.patientId));
      const emVisits = await tx.visit.findMany({
        where: { visitType: 'EMERGENCY', status: OPEN_VISIT },
        select: { patientId: true, createdAt: true },
      });
      const emergencyIds = new Set([
        ...openAdms.filter((a) => a.admissionType === 'EMERGENCY').map((a) => a.patientId),
        ...emVisits.map((v) => v.patientId),
      ]);

      const [activePatients, activeThisMonth, hmoPatients, hmoThisMonth] = await Promise.all([
        tx.patient.count({ where: { isActive: true } }),
        tx.patient.count({ where: { isActive: true, createdAt: { gte: monthStart } } }),
        tx.patient.count({ where: { payerType: 'HMO' } }),
        tx.patient.count({ where: { payerType: 'HMO', createdAt: { gte: monthStart } } }),
      ]);

      return {
        activePatients: { total: activePatients, addedThisMonth: activeThisMonth },
        inpatients: {
          total: inpatientIds.size,
          addedThisMonth: openAdms.filter((a) => a.admittedAt >= monthStart).length,
        },
        emergencyCases: {
          total: emergencyIds.size,
          addedThisMonth:
            openAdms.filter((a) => a.admissionType === 'EMERGENCY' && a.admittedAt >= monthStart)
              .length + emVisits.filter((v) => v.createdAt >= monthStart).length,
        },
        hmoPatients: { total: hmoPatients, addedThisMonth: hmoThisMonth },
      };
    });
  }

  // ─────────────────────────── detail ───────────────────────────

  async getOne(actor: Actor, id: string) {
    assertCan(actor.role, 'patient:read');
    return this.readOne(actor.tenantId, id);
  }

  /**
   * Internal patient lookup + shaping. No authorization: callers that have
   * already established their own action grant (create -> patient:register,
   * update -> patient:edit) use this directly so they do not transitively
   * depend on getOne()'s patient:read check.
   */
  private async readOne(tenantId: string, id: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const p = await tx.patient.findFirst({
        where: { id },
        include: { assignedDoctor: { select: { id: true, fullName: true, jobTitle: true } } },
      });
      if (!p) throw new NotFoundException('Patient not found');

      const [currentAdmission, visitCount, lastVisit, docCount, openComplaints, dxCount, activeRx, invoiceAgg] =
        await Promise.all([
          tx.admission.findFirst({
            where: { patientId: id, status: 'ADMITTED' },
            include: { ward: { select: { name: true } }, bed: { select: { label: true } } },
          }),
          tx.visit.count({ where: { patientId: id } }),
          tx.visit.findFirst({ where: { patientId: id }, orderBy: { startsAt: 'desc' } }),
          tx.patientDocument.count({ where: { patientId: id } }),
          tx.complaint.count({ where: { patientId: id, status: 'OPEN' } }),
          tx.diagnosis.count({ where: { patientId: id } }),
          tx.prescription.count({ where: { patientId: id, status: 'ACTIVE' } }),
          tx.invoice.aggregate({
            where: { patientId: id, status: { in: ['UNPAID', 'PARTIAL'] } },
            _sum: { totalAmount: true },
            _count: true,
          }),
        ]);

      return {
        ...p,
        photoUrl: await this.files.presignRef(tenantId, p.photoUrl, tx as any),
        age: ageFrom(p.dateOfBirth),
        status: currentAdmission
          ? 'INPATIENT'
          : p.registrationStatus === 'INCOMPLETE'
            ? 'INCOMPLETE'
            : 'ACTIVE',
        currentAdmission: currentAdmission
          ? {
              id: currentAdmission.id,
              admissionNumber: currentAdmission.admissionNumber,
              ward: currentAdmission.ward?.name ?? null,
              bed: currentAdmission.bed?.label ?? null,
              admittedAt: currentAdmission.admittedAt,
            }
          : null,
        counts: {
          appointments: visitCount,
          documents: docCount,
          openComplaints,
          diagnoses: dxCount,
          activePrescriptions: activeRx,
          outstandingInvoices: invoiceAgg._count,
          outstandingAmount: (invoiceAgg._sum.totalAmount ?? new Prisma.Decimal(0)).toString(),
        },
        lastVisitAt: lastVisit?.startsAt ?? null,
      };
    });
  }

  // ─────────────────────────── create / update ───────────────────────────

  async create(actor: Actor, dto: CreatePatientDto) {
    assertCan(actor.role, 'patient:register');
    const patient = await this.prisma.forTenant(actor.tenantId, async (tx) => {
      return tx.patient.create({
        data: {
          tenantId: actor.tenantId,
          patientNumber: await this.nextPatientNumber(tx, actor.tenantId),
          firstName: dto.firstName,
          middleName: dto.middleName,
          lastName: dto.lastName,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          gender: dto.gender,
          maritalStatus: dto.maritalStatus,
          nationality: dto.nationality,
          occupation: dto.occupation,
          phone: dto.phone,
          altPhone: dto.altPhone,
          email: dto.email,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          country: dto.country ?? 'NG',
          payerType: dto.payerType ?? undefined,
          hmoName: dto.hmoName,
          hmoNumber: dto.hmoNumber,
          assignedDoctorId: dto.assignedDoctorId ?? null,
          registrationStatus: RegistrationStatus.INCOMPLETE,
          registrationStep: 2,
          createdById: actor.userId,
        },
      });
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'CREATE',
      entityType: 'Patient', entityId: patient.id,
    });
    return this.readOne(actor.tenantId, patient.id);
  }

  async update(actor: Actor, id: string, dto: UpdatePatientDto) {
    assertCan(actor.role, 'patient:edit');
    await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.patient.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Patient not found');

      const data: Prisma.PatientUpdateInput = {};
      const copy = <K extends keyof UpdatePatientDto>(k: K, transform?: (v: any) => any) => {
        if (dto[k] !== undefined) (data as any)[k] = transform ? transform(dto[k]) : dto[k];
      };
      [
        'firstName', 'middleName', 'lastName', 'gender', 'maritalStatus', 'nationality',
        'occupation', 'phone', 'altPhone', 'email', 'address', 'city', 'state', 'country',
        'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactPhone',
        'emergencyContactAltPhone', 'emergencyContactAddress',
        'bloodGroup', 'rhFactor', 'genotype', 'allergies', 'chronicConditions',
        'currentMedications', 'previousSurgeries', 'disabilities', 'pregnancyStatus',
        'familyHistory', 'heightCm', 'weightKg',
        'historyPresentingComplaint', 'pastMedicalHistory', 'drugHistory',
        'reproductiveHistory', 'socialHistory',
        'payerType', 'hmoName', 'hmoNumber', 'insuranceProvider', 'insuranceNumber',
        'insurancePlanType', 'insuranceEmployer', 'idDocumentType', 'idDocumentNumber',
        'consentTreatment', 'consentDataProcessing', 'isActive',
      ].forEach((k) => copy(k as keyof UpdatePatientDto));

      if (dto.dateOfBirth !== undefined)
        data.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
      if (dto.insuranceExpiry !== undefined)
        data.insuranceExpiry = dto.insuranceExpiry ? new Date(dto.insuranceExpiry) : null;
      if (dto.assignedDoctorId !== undefined)
        data.assignedDoctor = dto.assignedDoctorId
          ? { connect: { id: dto.assignedDoctorId } }
          : { disconnect: true };

      if (dto.consentTreatment && !existing.consentGivenAt) {
        data.consentGivenAt = new Date();
        data.consentObtainedById = actor.userId;
      }
      if (dto.reachedStep && dto.reachedStep > existing.registrationStep) {
        data.registrationStep = dto.reachedStep;
      }
      if (dto.completeRegistration) {
        data.registrationStatus = RegistrationStatus.COMPLETE;
        data.registrationStep = 8;
      }

      await tx.patient.update({ where: { id }, data });
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE',
      entityType: 'Patient', entityId: id,
    });
    return this.readOne(actor.tenantId, id);
  }

  // ─────────────────────────── dedupe ───────────────────────────

  async checkDuplicates(actor: Actor, dto: CheckDuplicatesDto) {
    // Registration-specific endpoint: it exists only to warn the registrar about a
    // possible existing record during intake, and returns a deliberately thin
    // projection (name, DOB, phone, gender). Gated with 'patient:register' rather
    // than 'patient:read' so it tracks who may register patients, not who may read
    // charts. Same role set today, but the intent differs.
    assertCan(actor.role, 'patient:register');
    if (!dto.lastName && !dto.phone) return { matches: [] };
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const or: Prisma.PatientWhereInput[] = [];
      if (dto.phone) or.push({ phone: { contains: dto.phone } });
      if (dto.lastName && dto.firstName)
        or.push({
          AND: [
            { lastName: { equals: dto.lastName, mode: 'insensitive' } },
            { firstName: { startsWith: dto.firstName.slice(0, 3), mode: 'insensitive' } },
          ],
        });
      if (dto.dateOfBirth && dto.lastName)
        or.push({
          AND: [
            { lastName: { equals: dto.lastName, mode: 'insensitive' } },
            { dateOfBirth: new Date(dto.dateOfBirth) },
          ],
        });
      if (!or.length) return { matches: [] };

      const matches = await tx.patient.findMany({
        where: { OR: or },
        select: {
          id: true, patientNumber: true, firstName: true, middleName: true,
          lastName: true, dateOfBirth: true, phone: true, gender: true,
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      });
      return { matches: matches.map((m) => ({ ...m, age: ageFrom(m.dateOfBirth) })) };
    });
  }

  // ─────────────────────────── documents ───────────────────────────

  async listDocuments(actor: Actor, patientId: string) {
    assertCan(actor.role, 'patient:read');
    const { tenantId } = actor;
    const docs = await this.prisma.forTenant(tenantId, (tx) =>
      tx.patientDocument.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    // No presigned URL here - it would sit bearer-free in this response for its
    // whole TTL. The client fetches one at click time via documentDownloadUrl().
    return docs.map((d) => ({
      id: d.id,
      category: d.category,
      title: d.title,
      note: d.note,
      fileName: d.fileName,
      mimeType: d.mimeType,
      createdAt: d.createdAt,
    }));
  }

  /** Mint a short-lived download URL for one document (called when the user clicks). */
  async documentDownloadUrl(actor: Actor, patientId: string, docId: string) {
    assertCan(actor.role, 'patient:read');
    const doc = await this.prisma.forTenant(actor.tenantId, (tx) =>
      tx.patientDocument.findFirst({ where: { id: docId, patientId } }),
    );
    if (!doc) throw new NotFoundException('Document not found');
    const url = await this.files.presignRef(actor.tenantId, doc.fileUrl, 120);
    if (!url) throw new NotFoundException('The file for this document is not available.');
    return { url };
  }

  async addDocument(
    actor: Actor,
    patientId: string,
    dto: { category: string; title: string; note?: string },
    file: Express.Multer.File,
  ) {
    assertCan(actor.role, 'patient:document');
    const patient = await this.prisma.forTenant(actor.tenantId, (tx) =>
      tx.patient.findFirst({ where: { id: patientId }, select: { id: true } }),
    );
    if (!patient) throw new NotFoundException('Patient not found');

    const stored = await this.files.upload(actor, file, 'DOCUMENT');
    const doc = await this.prisma.forTenant(actor.tenantId, (tx) =>
      tx.patientDocument.create({
        data: {
          tenantId: actor.tenantId,
          patientId,
          category: (dto.category as any) ?? 'OTHER',
          title: dto.title,
          note: dto.note,
          fileName: stored.originalName,
          mimeType: stored.mimeType,
          fileUrl: `/api/files/${stored.id}`,
          uploadedById: actor.userId,
        },
      }),
    );
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'ADD_DOCUMENT',
      entityType: 'Patient', entityId: patientId, metadata: { title: dto.title, file: stored.id },
    });
    return {
      id: doc.id, category: doc.category, title: doc.title, note: doc.note,
      fileName: doc.fileName, mimeType: doc.mimeType, createdAt: doc.createdAt,
    };
  }

  async deleteDocument(actor: Actor, patientId: string, docId: string) {
    assertCan(actor.role, 'patient:document');
    const doc = await this.prisma.forTenant(actor.tenantId, (tx) =>
      tx.patientDocument.findFirst({ where: { id: docId, patientId } }),
    );
    if (!doc) throw new NotFoundException('Document not found');
    // Holding 'patient:document' lets a role add documents to any patient, but
    // deletion is destructive and irreversible. Restrict it to the person who
    // uploaded the document or a hospital admin, reusing the same owner-or-admin
    // rule Wave 0 established for the generic /files/:id routes
    // (FilesService.assertActorCanUseHandle).
    const isUploader = !!doc.uploadedById && doc.uploadedById === actor.userId;
    if (!isUploader && !can(actor.role, 'admin:settings')) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'FORBIDDEN_DOCUMENT_DELETE',
        message: 'Only the uploader or a hospital admin can delete this document',
      });
    }
    const fileId = doc.fileUrl?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];
    await this.prisma.forTenant(actor.tenantId, (tx) => tx.patientDocument.delete({ where: { id: docId } }));
    if (fileId) await this.files.remove(actor, fileId).catch(() => undefined);
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'DELETE_DOCUMENT',
      entityType: 'Patient', entityId: patientId,
      metadata: { docId, title: doc.title, file: fileId ?? null },
    });
    return { ok: true };
  }

  async setPhoto(actor: Actor, patientId: string, file: Express.Multer.File) {
    assertCan(actor.role, 'patient:edit');
    const existing = await this.prisma.forTenant(actor.tenantId, (tx) =>
      tx.patient.findFirst({ where: { id: patientId }, select: { id: true, photoUrl: true } }),
    );
    if (!existing) throw new NotFoundException('Patient not found');
    const stored = await this.files.upload(actor, file, 'PHOTO');
    await this.prisma.forTenant(actor.tenantId, (tx) =>
      tx.patient.update({ where: { id: patientId }, data: { photoUrl: `/api/files/${stored.id}` } }),
    );
    const prevId = existing.photoUrl?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];
    if (prevId && prevId !== stored.id) await this.files.remove(actor, prevId).catch(() => undefined);
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE',
      entityType: 'Patient', entityId: patientId, metadata: { photo: stored.id },
    });
    return { photoUrl: await this.files.presignRef(actor.tenantId, `/api/files/${stored.id}`) };
  }
}
