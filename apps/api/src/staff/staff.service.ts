import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { assertCan, can } from '../common/permissions';
import { CreateStaffDto, ListStaffQueryDto, SetPasswordDto, UpdateStaffDto } from './dto/staff.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

const PAGE_SIZE = 25;

const STAFF_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  role: true,
  jobTitle: true,
  notes: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  invitedById: true,
  departments: {
    select: {
      isPrimary: true,
      department: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class StaffService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private shape(u: any) {
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      role: u.role,
      jobTitle: u.jobTitle,
      notes: u.notes,
      isActive: u.isActive,
      accountStatus: u.isActive ? 'Active' : 'Inactive',
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      departments: (u.departments ?? [])
        .map((d: any) => ({ id: d.department.id, name: d.department.name, isPrimary: d.isPrimary }))
        .sort((a: any, b: any) => Number(b.isPrimary) - Number(a.isPrimary)),
    };
  }

  async list(actor: Actor, q: ListStaffQueryDto) {
    // The staff directory carries HR data (contact details, free-text notes,
    // role). It is an admin-only view; the API is the gate, not just the UI.
    assertCan(actor.role, 'staff:manage');
    const { tenantId } = actor;
    const page = q.page && q.page > 0 ? q.page : 1;
    const where: Prisma.UserWhereInput = { tenantId };
    if (q.search) {
      where.OR = [
        { fullName: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { phone: { contains: q.search } },
      ];
    }
    if (q.role) where.role = q.role as Role;
    if (q.status === 'active') where.isActive = true;
    else if (q.status === 'inactive') where.isActive = false;

    // STAFF_SELECT joins Department (RLS-scoped) - run inside forTenant so the
    // department sub-select resolves. User itself is scoped by `where.tenantId`.
    const [total, rows] = await this.prisma.forTenant(tenantId, (tx) =>
      Promise.all([
        tx.user.count({ where }),
        tx.user.findMany({
          where,
          select: STAFF_SELECT,
          orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]),
    );
    return { page, pageSize: PAGE_SIZE, total, staff: rows.map((r) => this.shape(r)) };
  }

  async getOne(actor: Actor, id: string) {
    assertCan(actor.role, 'staff:manage');
    const { tenantId } = actor;
    // STAFF_SELECT joins Department, and the counts hit Patient / Visit - all
    // RLS-scoped, so the whole read runs inside forTenant.
    const { u, invitedBy, assignedPatientCount, upcomingVisitCount } = await this.prisma.forTenant(
      tenantId,
      async (tx) => {
        const u = await tx.user.findFirst({ where: { id, tenantId }, select: STAFF_SELECT });
        if (!u) throw new NotFoundException('Staff member not found');
        const [invitedBy, assignedPatientCount, upcomingVisitCount] = await Promise.all([
          u.invitedById
            ? tx.user.findUnique({ where: { id: u.invitedById }, select: { fullName: true } })
            : null,
          tx.patient.count({ where: { assignedDoctorId: id, isActive: true } }),
          tx.visit.count({
            where: { doctorId: id, startsAt: { gte: new Date() }, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
          }),
        ]);
        return { u, invitedBy, assignedPatientCount, upcomingVisitCount };
      },
    );

    return {
      ...this.shape(u),
      createdAt: u.createdAt.toISOString(),
      invitedByName: invitedBy?.fullName ?? null,
      assignedPatientCount,
      upcomingVisitCount,
    };
  }

  async create(actor: Actor, dto: CreateStaffDto) {
    assertCan(actor.role, 'staff:manage');
    const email = dto.email.toLowerCase();

    const clash = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: actor.tenantId, email } },
      select: { id: true },
    });
    if (clash) throw new ConflictException({ message: 'A staff member with this email already exists', code: 'EMAIL_IN_USE' });

    await this.assertDepartments(actor.tenantId, dto.departmentIds);

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        tenantId: actor.tenantId,
        email,
        passwordHash,
        fullName: `${dto.firstName} ${dto.lastName}`.trim(),
        phone: dto.phone,
        role: dto.role,
        jobTitle: dto.jobTitle,
        notes: dto.notes,
        emailVerifiedAt: new Date(), // admin-vouched: the user can sign in straight away
        isActive: true,
        invitedById: actor.userId,
        departments: dto.departmentIds?.length
          ? {
              create: dto.departmentIds.map((departmentId, i) => ({
                tenantId: actor.tenantId,
                departmentId,
                isPrimary: i === 0,
              })),
            }
          : undefined,
      },
      select: { id: true },
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'CREATE',
      entityType: 'User', entityId: user.id, metadata: { role: dto.role },
    });
    return this.getOne(actor, user.id);
  }

  async update(actor: Actor, id: string, dto: UpdateStaffDto) {
    assertCan(actor.role, 'staff:manage');
    const existing = await this.prisma.user.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!existing) throw new NotFoundException('Staff member not found');

    if (dto.role && dto.role !== existing.role && id === actor.userId && !can(dto.role, 'staff:manage')) {
      throw new BadRequestException({
        message: 'You cannot remove your own admin access',
        code: 'SELF_DEMOTION',
      });
    }
    if (dto.role && dto.role !== existing.role && existing.role === Role.HOSPITAL_ADMIN) {
      await this.assertNotLastAdmin(actor.tenantId, id);
    }
    if (dto.departmentIds) await this.assertDepartments(actor.tenantId, dto.departmentIds);

    const data: Prisma.UserUpdateInput = {};
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      const [first, ...rest] = existing.fullName.split(' ');
      const newFirst = dto.firstName ?? first ?? '';
      const newLast = dto.lastName ?? rest.join(' ');
      data.fullName = `${newFirst} ${newLast}`.trim();
    }
    if (dto.phone !== undefined) data.phone = dto.phone || null;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.jobTitle !== undefined) data.jobTitle = dto.jobTitle || null;
    if (dto.notes !== undefined) data.notes = dto.notes || null;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data });
      if (dto.departmentIds) {
        await tx.userDepartment.deleteMany({ where: { userId: id } });
        if (dto.departmentIds.length) {
          await tx.userDepartment.createMany({
            data: dto.departmentIds.map((departmentId, i) => ({
              tenantId: actor.tenantId,
              userId: id,
              departmentId,
              isPrimary: i === 0,
            })),
          });
        }
      }
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE',
      entityType: 'User', entityId: id,
    });
    return this.getOne(actor, id);
  }

  async setActive(actor: Actor, id: string, active: boolean) {
    assertCan(actor.role, 'staff:manage');
    const target = await this.prisma.user.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!target) throw new NotFoundException('Staff member not found');

    if (!active) {
      if (id === actor.userId) {
        throw new BadRequestException({ message: 'You cannot deactivate your own account', code: 'SELF_DEACTIVATE' });
      }
      if (target.role === Role.HOSPITAL_ADMIN && target.isActive) {
        await this.assertNotLastAdmin(actor.tenantId, id);
      }
    }

    await this.prisma.user.update({ where: { id }, data: { isActive: active } });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId,
      action: active ? 'ACTIVATE' : 'DEACTIVATE', entityType: 'User', entityId: id,
    });
    return this.getOne(actor, id);
  }

  async setPassword(actor: Actor, id: string, dto: SetPasswordDto) {
    assertCan(actor.role, 'staff:manage');
    const target = await this.prisma.user.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!target) throw new NotFoundException('Staff member not found');

    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(dto.password, 12),
        emailVerifiedAt: target.emailVerifiedAt ?? new Date(),
      },
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'RESET_PASSWORD',
      entityType: 'User', entityId: id,
    });
    return { ok: true };
  }

  // ── helpers ──

  private async assertDepartments(tenantId: string, ids?: string[]) {
    if (!ids?.length) return;
    // Department is RLS-scoped - the forTenant context does the tenant filtering.
    const count = await this.prisma.forTenant(tenantId, (tx) =>
      tx.department.count({ where: { id: { in: ids } } }),
    );
    if (count !== new Set(ids).size) throw new BadRequestException('One or more departments are invalid');
  }

  private async assertNotLastAdmin(tenantId: string, excludingUserId: string) {
    const others = await this.prisma.user.count({
      where: { tenantId, role: Role.HOSPITAL_ADMIN, isActive: true, id: { not: excludingUserId } },
    });
    if (others === 0) {
      throw new BadRequestException({
        message: 'This is the last active hospital admin. Promote another admin first.',
        code: 'LAST_ADMIN',
      });
    }
  }
}
