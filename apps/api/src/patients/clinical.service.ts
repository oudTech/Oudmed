import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { assertCan } from '../common/permissions';
import {
  CreateComplaintDto,
  CreateDiagnosisDto,
  CreatePrescriptionDto,
  CreateVitalsDto,
  UpdateComplaintDto,
  UpdatePrescriptionDto,
} from './dto/clinical.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

@Injectable()
export class ClinicalService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private billing: BillingService,
  ) {}

  private async assertPatient(tx: Prisma.TransactionClient, patientId: string) {
    const p = await tx.patient.findFirst({ where: { id: patientId }, select: { id: true } });
    if (!p) throw new NotFoundException('Patient not found');
  }

  /** Resolve a set of user ids to a { id: fullName } map (staff live outside RLS). */
  private async names(tx: Prisma.TransactionClient, ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const users = await tx.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  // ── complaints ──
  async listComplaints(actor: Actor, patientId: string) {
    assertCan(actor.role, 'patient:read');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const rows = await tx.complaint.findMany({
        where: { patientId },
        orderBy: { recordedAt: 'desc' },
      });
      const names = await this.names(tx, rows.map((r) => r.recordedById));
      return rows.map((r) => ({
        ...r,
        recordedByName: r.recordedById ? names.get(r.recordedById) ?? null : null,
      }));
    });
  }

  async addComplaint(actor: Actor, patientId: string, dto: CreateComplaintDto) {
    assertCan(actor.role, 'complaint:record');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      await this.assertPatient(tx, patientId);
      const row = await tx.complaint.create({
        data: {
          tenantId: actor.tenantId, patientId,
          description: dto.description, onsetNote: dto.onsetNote,
          severity: dto.severity, visitId: dto.visitId,
          recordedById: actor.userId,
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'ADD_COMPLAINT',
        entityType: 'Patient', entityId: patientId,
      });
      return row;
    });
  }

  async updateComplaint(actor: Actor, patientId: string, id: string, dto: UpdateComplaintDto) {
    assertCan(actor.role, 'complaint:record');
    const updated = await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const row = await tx.complaint.findFirst({ where: { id, patientId } });
      if (!row) throw new NotFoundException('Complaint not found');
      return tx.complaint.update({ where: { id }, data: dto });
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE_COMPLAINT',
      entityType: 'Patient', entityId: patientId, metadata: { complaintId: id, fields: Object.keys(dto) },
    });
    return updated;
  }

  // ── diagnoses ──
  async listDiagnoses(actor: Actor, patientId: string) {
    assertCan(actor.role, 'patient:read');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const rows = await tx.diagnosis.findMany({
        where: { patientId },
        orderBy: { diagnosedAt: 'desc' },
      });
      const names = await this.names(tx, rows.map((r) => r.diagnosedById));
      return rows.map((r) => ({
        ...r,
        recordedByName: r.diagnosedById ? names.get(r.diagnosedById) ?? null : null,
      }));
    });
  }

  async addDiagnosis(actor: Actor, patientId: string, dto: CreateDiagnosisDto) {
    assertCan(actor.role, 'diagnosis:record');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      await this.assertPatient(tx, patientId);
      const row = await tx.diagnosis.create({
        data: {
          tenantId: actor.tenantId, patientId,
          description: dto.description, code: dto.code,
          certainty: dto.certainty, attendanceType: dto.attendanceType, notes: dto.notes,
          visitId: dto.visitId, admissionId: dto.admissionId,
          diagnosedById: actor.userId,
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'ADD_DIAGNOSIS',
        entityType: 'Patient', entityId: patientId,
      });
      return row;
    });
  }

  // ── vitals ──
  async listVitals(actor: Actor, patientId: string) {
    assertCan(actor.role, 'patient:read');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const rows = await tx.vitalSigns.findMany({
        where: { patientId },
        orderBy: { recordedAt: 'desc' },
        take: 50,
      });
      const names = await this.names(tx, rows.map((r) => r.recordedById));
      return rows.map((r) => ({
        ...r,
        recordedByName: r.recordedById ? names.get(r.recordedById) ?? null : null,
      }));
    });
  }

  async addVitals(actor: Actor, patientId: string, dto: CreateVitalsDto) {
    assertCan(actor.role, 'vitals:record');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      await this.assertPatient(tx, patientId);
      let bmi: number | undefined;
      if (dto.weightKg && dto.heightCm) {
        const m = dto.heightCm / 100;
        bmi = Math.round((dto.weightKg / (m * m)) * 10) / 10;
      }
      const row = await tx.vitalSigns.create({
        data: {
          tenantId: actor.tenantId, patientId,
          temperatureC: dto.temperatureC, pulseBpm: dto.pulseBpm,
          respiratoryRate: dto.respiratoryRate, systolicBp: dto.systolicBp,
          diastolicBp: dto.diastolicBp, spo2: dto.spo2,
          weightKg: dto.weightKg, heightCm: dto.heightCm, bmi,
          bloodGlucose: dto.bloodGlucose, urineOutputMl: dto.urineOutputMl,
          avpu: dto.avpu, painScore: dto.painScore, notes: dto.notes,
          visitId: dto.visitId, admissionId: dto.admissionId,
          recordedById: actor.userId,
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'ADD_VITALS',
        entityType: 'Patient', entityId: patientId,
      });
      return row;
    });
  }

  // ── prescriptions ──
  async listPrescriptions(actor: Actor, patientId: string) {
    assertCan(actor.role, 'patient:read');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const rows = await tx.prescription.findMany({
        where: { patientId },
        include: { items: true },
        orderBy: { prescribedAt: 'desc' },
      });
      const names = await this.names(tx, [
        ...rows.map((r) => r.prescribedById),
        ...rows.map((r) => r.dispensedById),
      ]);
      return rows.map((r) => ({
        ...r,
        prescribedByName: r.prescribedById ? names.get(r.prescribedById) ?? null : null,
        dispensedByName: r.dispensedById ? names.get(r.dispensedById) ?? null : null,
      }));
    });
  }

  // ── investigations / orders ──
  async listOrders(actor: Actor, patientId: string) {
    assertCan(actor.role, 'patient:read');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const rows = await tx.clinicalOrder.findMany({
        where: { patientId },
        orderBy: { orderedAt: 'desc' },
      });
      const names = await this.names(tx, [
        ...rows.map((r) => r.orderedById),
        ...rows.map((r) => r.resultedById),
      ]);
      return rows.map((r) => ({
        id: r.id,
        visitId: r.visitId,
        orderType: r.orderType,
        name: r.name,
        status: r.status,
        priority: r.priority,
        orderedByName: r.orderedById ? names.get(r.orderedById) ?? null : null,
        orderedAt: r.orderedAt,
        resultValue: r.resultValue,
        resultUnit: r.resultUnit,
        referenceRange: r.referenceRange,
        abnormalFlag: r.abnormalFlag,
        resultNote: r.resultNote,
        resultedByName: r.resultedById ? names.get(r.resultedById) ?? null : null,
        resultedAt: r.resultedAt,
      }));
    });
  }

  async listNotes(actor: Actor, patientId: string) {
    assertCan(actor.role, 'patient:read');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const rows = await tx.clinicalNote.findMany({
        where: { patientId },
        orderBy: { updatedAt: 'desc' },
      });
      const names = await this.names(tx, rows.map((r) => r.authorId));
      return rows.map((r) => ({
        id: r.id,
        visitId: r.visitId,
        subjective: r.subjective,
        objective: r.objective,
        assessment: r.assessment,
        plan: r.plan,
        authorName: r.authorId ? names.get(r.authorId) ?? null : null,
        updatedAt: r.updatedAt,
      }));
    });
  }

  async addPrescription(actor: Actor, patientId: string, dto: CreatePrescriptionDto) {
    assertCan(actor.role, 'prescription:write');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      await this.assertPatient(tx, patientId);
      const row = await tx.prescription.create({
        data: {
          tenantId: actor.tenantId, patientId,
          notes: dto.notes, visitId: dto.visitId,
          prescribedById: actor.userId,
          items: { create: dto.items.map((it) => ({ ...it, tenantId: actor.tenantId })) },
        },
        include: { items: true },
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'ADD_PRESCRIPTION',
        entityType: 'Patient', entityId: patientId,
      });
      return row;
    });
  }

  async updatePrescription(actor: Actor, patientId: string, id: string, dto: UpdatePrescriptionDto) {
    assertCan(actor.role, 'prescription:write');
    const { updated, prevStatus } = await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const row = await tx.prescription.findFirst({ where: { id, patientId } });
      if (!row) throw new NotFoundException('Prescription not found');
      const next = await tx.prescription.update({
        where: { id },
        data: { status: dto.status },
        include: { items: true },
      });
      return { updated: next, prevStatus: row.status };
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE_PRESCRIPTION',
      entityType: 'Patient', entityId: patientId,
      metadata: { prescriptionId: id, status: { before: prevStatus, after: updated.status } },
    });
    return updated;
  }

  // ── tab data that lives on other models ──
  async listAppointments(actor: Actor, patientId: string) {
    assertCan(actor.role, 'patient:read');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const visits = await tx.visit.findMany({
        where: { patientId },
        include: {
          doctor: { select: { id: true, fullName: true } },
          department: { select: { id: true, name: true } },
          invoice: { select: { id: true, invoiceNumber: true, status: true } },
        },
        orderBy: { startsAt: 'desc' },
        take: 100,
      });
      const visitIds = visits.map((v) => v.id);
      const [diagnoses, notes, orderCounts] = await Promise.all([
        visitIds.length
          ? tx.diagnosis.findMany({
              where: { visitId: { in: visitIds } },
              orderBy: { diagnosedAt: 'asc' },
              select: { visitId: true, description: true },
            })
          : [],
        visitIds.length
          ? tx.clinicalNote.findMany({ where: { visitId: { in: visitIds } }, select: { visitId: true } })
          : [],
        visitIds.length
          ? tx.clinicalOrder.groupBy({
              by: ['visitId'],
              where: { visitId: { in: visitIds } },
              _count: { _all: true },
            })
          : [],
      ]);
      const dxByVisit = new Map<string, string>();
      for (const d of diagnoses) {
        if (d.visitId && !dxByVisit.has(d.visitId)) dxByVisit.set(d.visitId, d.description);
      }
      const noteVisits = new Set(notes.map((n) => n.visitId));
      const orderCountByVisit = new Map(
        orderCounts.map((o) => [o.visitId, o._count._all]),
      );
      return visits.map((v) => ({
        id: v.id,
        visitType: v.visitType,
        status: v.status,
        startsAt: v.startsAt,
        reason: v.reason,
        doctor: v.doctor,
        department: v.department,
        primaryDiagnosis: dxByVisit.get(v.id) ?? null,
        invoice: v.invoice ?? null,
        hasNote: noteVisits.has(v.id),
        orderCount: orderCountByVisit.get(v.id) ?? 0,
      }));
    });
  }

  async payInvoice(
    actor: Actor,
    patientId: string,
    invoiceId: string,
    dto: {
      amount: number; method?: string; payerType?: string;
      payerName?: string; reference?: string; note?: string; idempotencyKey?: string;
    },
  ) {
    return this.billing.addPayment(
      actor,
      invoiceId,
      {
        amount: dto.amount,
        method: (dto.method as PaymentMethod) ?? PaymentMethod.CASH,
        payerType: dto.payerType as any,
        payerName: dto.payerName,
        reference: dto.reference,
        note: dto.note,
        idempotencyKey: dto.idempotencyKey,
      },
      { patientId },
    );
  }

  async listInvoices(actor: Actor, patientId: string) {
    assertCan(actor.role, 'patient:read');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const rows = await tx.invoice.findMany({
        where: { patientId },
        include: { lines: true, payments: true },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((inv) => {
        const paid = inv.payments
          .filter((p) => !p.reversedAt)
          .reduce((sum, p) => sum.add(p.amount), new Prisma.Decimal(0));
        const balance = inv.totalAmount.sub(paid);
        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          category: inv.category ?? null,
          status: inv.status,
          totalAmount: inv.totalAmount.toString(),
          paidAmount: paid.toString(),
          balanceDue: (balance.lt(0) ? new Prisma.Decimal(0) : balance).toString(),
          createdAt: inv.createdAt,
          lineCount: inv.lines.length,
        };
      });
    });
  }
}
