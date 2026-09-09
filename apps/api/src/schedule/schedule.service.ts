import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VisitStatus, VisitType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { assertCan, STATUS_ACTION } from '../common/permissions';
import {
  CreateVisitDto,
  ListVisitsQueryDto,
  RescheduleVisitDto,
  SetVisitStatusDto,
  UpdateVisitDto,
} from './dto/schedule.dto';

const VISIT_INCLUDE = {
  patient: {
    select: {
      id: true, patientNumber: true, firstName: true, lastName: true,
      phone: true, gender: true, payerType: true, hmoName: true,
    },
  },
  doctor: { select: { id: true, fullName: true, jobTitle: true } },
  department: { select: { id: true, name: true } },
} satisfies Prisma.VisitInclude;

/** Allowed status transitions. Anything not listed is rejected. */
const TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  SCHEDULED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'SCHEDULED', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CHECKED_IN', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: ['SCHEDULED'],
  NO_SHOW: ['SCHEDULED'],
};

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

@Injectable()
export class ScheduleService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private billing: BillingService,
  ) {}

  async list(tenantId: string, q: ListVisitsQueryDto) {
    const from = q.from ? new Date(q.from) : startOfToday();
    const to = q.to ? new Date(q.to) : endOfToday(from);
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.visit.findMany({
        where: {
          startsAt: { gte: from, lte: to },
          ...(q.doctorId ? { doctorId: q.doctorId } : {}),
          ...(q.departmentId ? { departmentId: q.departmentId } : {}),
          ...(q.status ? { status: q.status } : {}),
        },
        include: VISIT_INCLUDE,
        orderBy: { startsAt: 'asc' },
      }),
    );
  }

  async getOne(tenantId: string, id: string) {
    const visit = await this.prisma.forTenant(tenantId, (tx) =>
      tx.visit.findFirst({ where: { id }, include: VISIT_INCLUDE }),
    );
    if (!visit) throw new NotFoundException('Appointment not found');
    return visit;
  }

  async create(actor: Actor, dto: CreateVisitDto) {
    assertCan(actor.role, 'appointment:book');
    const startsAt = new Date(dto.startsAt);
    const endsAt = resolveEnd(startsAt, dto.endsAt, dto.durationMinutes);
    if (endsAt <= startsAt) throw new BadRequestException('End time must be after start time');

    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const patient = await tx.patient.findFirst({ where: { id: dto.patientId } });
      if (!patient) throw new NotFoundException('Patient not found');

      if (dto.doctorId) {
        await this.assertDoctor(tx, dto.doctorId);
        await this.assertAvailable(tx, dto.doctorId, startsAt, endsAt, undefined, dto.force);
      }

      const visit = await tx.visit.create({
        data: {
          tenantId: actor.tenantId,
          patientId: dto.patientId,
          doctorId: dto.doctorId ?? null,
          departmentId: dto.departmentId ?? null,
          visitType: dto.visitType ?? VisitType.CONSULTATION,
          startsAt,
          endsAt,
          reason: dto.reason,
          roomLabel: dto.roomLabel,
          payerType: dto.payerType ?? patient.payerType,
          hmoName: dto.hmoName ?? patient.hmoName,
          authCode: dto.authCode,
          bookedById: actor.userId,
        },
        include: VISIT_INCLUDE,
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'CREATE',
        entityType: 'Visit', entityId: visit.id,
        metadata: { visitType: visit.visitType, startsAt: startsAt.toISOString() },
      });
      return visit;
    });
  }

  async update(actor: Actor, id: string, dto: UpdateVisitDto) {
    assertCan(actor.role, 'appointment:edit');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.visit.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Appointment not found');
      if (dto.doctorId) await this.assertDoctor(tx, dto.doctorId);

      const visit = await tx.visit.update({
        where: { id },
        data: {
          doctorId: dto.doctorId ?? undefined,
          departmentId: dto.departmentId ?? undefined,
          visitType: dto.visitType ?? undefined,
          reason: dto.reason ?? undefined,
          notes: dto.notes ?? undefined,
          roomLabel: dto.roomLabel ?? undefined,
          payerType: dto.payerType ?? undefined,
          hmoName: dto.hmoName ?? undefined,
          authCode: dto.authCode ?? undefined,
        },
        include: VISIT_INCLUDE,
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE',
        entityType: 'Visit', entityId: id,
      });
      return visit;
    });
  }

  async reschedule(actor: Actor, id: string, dto: RescheduleVisitDto) {
    assertCan(actor.role, 'appointment:reschedule');
    const startsAt = new Date(dto.startsAt);
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.visit.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Appointment not found');
      if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
        throw new BadRequestException('This appointment can no longer be rescheduled');
      }
      const endsAt = resolveEnd(
        startsAt,
        dto.endsAt,
        dto.durationMinutes ?? minutesBetween(existing.startsAt, existing.endsAt),
      );
      const doctorId = dto.doctorId ?? existing.doctorId;
      if (doctorId) await this.assertAvailable(tx, doctorId, startsAt, endsAt, id, dto.force);

      const visit = await tx.visit.update({
        where: { id },
        data: { startsAt, endsAt, doctorId: doctorId ?? null },
        include: VISIT_INCLUDE,
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'RESCHEDULE',
        entityType: 'Visit', entityId: id, metadata: { startsAt: startsAt.toISOString() },
      });
      return visit;
    });
  }

  async setStatus(actor: Actor, id: string, dto: SetVisitStatusDto) {
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.visit.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Appointment not found');

      if (existing.status !== dto.status) {
        assertCan(actor.role, STATUS_ACTION[dto.status]);
        if (!TRANSITIONS[existing.status].includes(dto.status)) {
          throw new ConflictException({
            message: `Cannot move an appointment from ${existing.status} to ${dto.status}`,
            code: 'INVALID_TRANSITION',
          });
        }
      }

      const now = new Date();
      const data: Prisma.VisitUpdateInput = { status: dto.status };
      if (dto.status === 'CHECKED_IN') data.checkedInAt = existing.checkedInAt ?? now;
      if (dto.status === 'IN_PROGRESS') data.startedAt = existing.startedAt ?? now;
      if (dto.status === 'COMPLETED') data.completedAt = now;
      if (dto.status === 'SCHEDULED') {
        data.checkedInAt = null;
        data.startedAt = null;
        data.completedAt = null;
      }
      if (dto.reason) data.notes = appendNote(existing.notes, dto.status, dto.reason);

      const visit = await tx.visit.update({ where: { id }, data, include: VISIT_INCLUDE });

      if (dto.status === 'COMPLETED') {
        await this.draftInvoiceForVisit(tx, actor, id);
      }

      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId,
        action: `STATUS_${dto.status}`, entityType: 'Visit', entityId: id,
      });
      return visit;
    });
  }

  // ── helpers ──

  private async assertDoctor(tx: Prisma.TransactionClient, doctorId: string) {
    const doc = await tx.user.findFirst({ where: { id: doctorId, isActive: true } });
    if (!doc) throw new BadRequestException('Selected doctor is not available');
  }

  /** Rejects double-bookings and slots outside the doctor's working hours (unless `force`). */
  private async assertAvailable(
    tx: Prisma.TransactionClient,
    doctorId: string,
    startsAt: Date,
    endsAt: Date,
    ignoreId?: string,
    force?: boolean,
  ) {
    if (force) return;

    const clash = await tx.visit.findFirst({
      where: {
        doctorId,
        id: ignoreId ? { not: ignoreId } : undefined,
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'COMPLETED'] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        message: 'That doctor already has an appointment in this time slot',
        code: 'DOCTOR_DOUBLE_BOOKED',
        clashesWith: clash.id,
      });
    }

    const allShifts = await tx.doctorShift.findMany({ where: { doctorId } });
    if (allShifts.length === 0) return; // no working-hours template configured -> don't block

    const dayShifts = allShifts.filter((s) => s.dayOfWeek === startsAt.getDay());
    const startMin = startsAt.getHours() * 60 + startsAt.getMinutes();
    let endMin = endsAt.getHours() * 60 + endsAt.getMinutes();
    if (endsAt.getDate() !== startsAt.getDate() || endMin <= startMin) endMin = 24 * 60;
    const covered = dayShifts.some((s) => s.startMinute <= startMin && s.endMinute >= endMin);
    if (!covered) {
      throw new ConflictException({
        message: "That time is outside the doctor's working hours",
        code: 'OUTSIDE_WORKING_HOURS',
      });
    }
  }

  /** On completion, make sure the visit's invoice carries a consultation line, once. */
  private async draftInvoiceForVisit(tx: Prisma.TransactionClient, actor: Actor, visitId: string) {
    const visit = await tx.visit.findFirst({
      where: { id: visitId },
      include: { invoice: { include: { lines: true } } },
    });
    if (!visit) return;

    const alreadyBilled = visit.invoice?.lines.some((l) => l.category === 'Consultation');
    if (alreadyBilled) return;

    const svc = await tx.serviceItem.findFirst({
      where: {
        isActive: true,
        OR: [{ category: 'Consultation' }, { name: { contains: 'Consultation', mode: 'insensitive' } }],
      },
      orderBy: { unitPrice: 'asc' },
    });

    await this.billing.postChargeToVisit(tx, {
      tenantId: actor.tenantId,
      userId: actor.userId,
      visitId,
      patientId: visit.patientId,
      serviceItemId: svc?.id ?? null,
      description: svc?.name ?? 'Consultation',
      quantity: 1,
      unitPrice: svc?.unitPrice ?? new Prisma.Decimal(0),
      category: 'Consultation',
    });
  }
}

function resolveEnd(startsAt: Date, endsAt?: string, durationMinutes?: number): Date {
  if (endsAt) return new Date(endsAt);
  return new Date(startsAt.getTime() + (durationMinutes ?? 30) * 60_000);
}
function minutesBetween(a: Date, b: Date): number {
  return Math.max(5, Math.round((b.getTime() - a.getTime()) / 60_000));
}
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday(from: Date): Date {
  const d = new Date(from);
  d.setHours(23, 59, 59, 999);
  return d;
}
function appendNote(current: string | null, status: string, reason: string): string {
  const line = `[${status}] ${reason}`;
  return current ? `${current}\n${line}` : line;
}
