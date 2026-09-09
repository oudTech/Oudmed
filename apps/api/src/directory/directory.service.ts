import { BadRequestException, Injectable } from '@nestjs/common';
import { BedStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertCan } from '../common/permissions';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

@Injectable()
export class DirectoryService {
  constructor(private prisma: PrismaService) {}

  async staff(tenantId: string, role?: string) {
    const roleFilter =
      role && (Object.values(Role) as string[]).includes(role) ? { role: role as Role } : undefined;
    // `shifts` is the RLS-scoped DoctorShift relation - resolve inside forTenant.
    const users = await this.prisma.forTenant(tenantId, (tx) =>
      tx.user.findMany({
        where: { tenantId, isActive: true, ...roleFilter },
        select: {
          id: true, fullName: true, email: true, role: true, jobTitle: true,
          avatarUrl: true, isActive: true,
          shifts: { select: { dayOfWeek: true, startMinute: true, endMinute: true } },
        },
        orderBy: { fullName: 'asc' },
      }),
    );
    return users.map((u) => ({
      ...u,
      shifts: u.shifts.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute),
    }));
  }

  async departments(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.department.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async wards(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const wards = await tx.ward.findMany({
        where: { isActive: true },
        include: { beds: { select: { status: true } } },
        orderBy: { name: 'asc' },
      });
      return wards.map((w) => ({
        id: w.id,
        name: w.name,
        wardType: w.wardType,
        bedCount: w.beds.length,
        availableBeds: w.beds.filter((b) => b.status === BedStatus.AVAILABLE).length,
      }));
    });
  }

  async beds(tenantId: string, wardId?: string, status?: string) {
    const statusFilter =
      status && (Object.values(BedStatus) as string[]).includes(status)
        ? { status: status as BedStatus }
        : undefined;
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.bed.findMany({
        where: { ...(wardId ? { wardId } : {}), ...statusFilter },
        select: { id: true, label: true, status: true, wardId: true },
        orderBy: { label: 'asc' },
      }),
    );
  }

  // ── doctor working hours ──

  async getShifts(tenantId: string, doctorId: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.doctorShift.findMany({
        where: { doctorId },
        select: { id: true, dayOfWeek: true, startMinute: true, endMinute: true },
        orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      }),
    );
  }

  async setShifts(
    actor: Actor,
    doctorId: string,
    shifts: { dayOfWeek: number; startMinute: number; endMinute: number }[],
  ) {
    assertCan(actor.role, 'doctor:set-hours');
    const doctor = await this.prisma.user.findFirst({
      where: { id: doctorId, tenantId: actor.tenantId, isActive: true },
    });
    if (!doctor) throw new BadRequestException('Doctor not found');
    for (const s of shifts) {
      if (s.dayOfWeek < 0 || s.dayOfWeek > 6 || s.endMinute <= s.startMinute) {
        throw new BadRequestException('Invalid shift range');
      }
    }
    await this.prisma.forTenant(actor.tenantId, async (tx) => {
      await tx.doctorShift.deleteMany({ where: { doctorId } });
      await tx.doctorShift.createMany({
        data: shifts.map((s) => ({ ...s, tenantId: actor.tenantId, doctorId })),
      });
    });
    return this.getShifts(actor.tenantId, doctorId);
  }
}
