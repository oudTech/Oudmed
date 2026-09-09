import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InsuranceKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { assertCan } from '../common/permissions';
import {
  DepartmentDto,
  InsuranceProviderDto,
  ListQueryDto,
  ServiceItemDto,
  UpdateDepartmentDto,
  UpdateInsuranceProviderDto,
  UpdateServiceItemDto,
} from './dto/admin.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

const PAGE_SIZE = 25;

const IN_USE = (message: string) =>
  new BadRequestException({ message, code: 'IN_USE' });

function pageOf(q: ListQueryDto) {
  return q.page && q.page > 0 ? q.page : 1;
}

function activeFilter(status?: string): boolean | undefined {
  if (status === 'active') return true;
  if (status === 'inactive') return false;
  return undefined;
}

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ─────────────────────────────── Departments ───────────────────────────────

  async listDepartments(tenantId: string, q: ListQueryDto) {
    const page = pageOf(q);
    const isActive = activeFilter(q.status);
    return this.prisma.forTenant(tenantId, async (tx) => {
      const where: Prisma.DepartmentWhereInput = {};
      if (isActive !== undefined) where.isActive = isActive;
      if (q.search) {
        where.OR = [
          { name: { contains: q.search, mode: 'insensitive' } },
          { code: { contains: q.search, mode: 'insensitive' } },
        ];
      }

      const [total, rows] = await Promise.all([
        tx.department.count({ where }),
        tx.department.findMany({
          where,
          orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      const counts = rows.length
        ? await tx.userDepartment.groupBy({
            by: ['departmentId'],
            where: { tenantId, departmentId: { in: rows.map((r) => r.id) } },
            _count: { departmentId: true },
          })
        : [];
      const countMap = new Map(counts.map((c) => [c.departmentId, c._count.departmentId]));

      return {
        page,
        pageSize: PAGE_SIZE,
        total,
        rows: rows.map((d) => ({
          id: d.id,
          name: d.name,
          code: d.code,
          phone: d.phone,
          notes: d.notes,
          isActive: d.isActive,
          userCount: countMap.get(d.id) ?? 0,
        })),
      };
    });
  }

  async createDepartment(actor: Actor, dto: DepartmentDto) {
    assertCan(actor.role, 'admin:settings');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      await this.assertDepartmentNameFree(tx, actor.tenantId, dto.name);
      const dept = await tx.department.create({
        data: {
          tenantId: actor.tenantId,
          name: dto.name,
          code: dto.code || null,
          phone: dto.phone || null,
          notes: dto.notes || null,
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'Department',
        entityId: dept.id,
        metadata: { name: dept.name },
      });
      return this.shapeDepartment(dept, 0);
    });
  }

  async updateDepartment(actor: Actor, id: string, dto: UpdateDepartmentDto) {
    assertCan(actor.role, 'admin:settings');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.department.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Department not found');
      if (dto.name && dto.name !== existing.name) {
        await this.assertDepartmentNameFree(tx, actor.tenantId, dto.name);
      }
      const dept = await tx.department.update({
        where: { id },
        data: {
          name: dto.name ?? undefined,
          code: dto.code !== undefined ? dto.code || null : undefined,
          phone: dto.phone !== undefined ? dto.phone || null : undefined,
          notes: dto.notes !== undefined ? dto.notes || null : undefined,
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'UPDATE',
        entityType: 'Department',
        entityId: id,
      });
      const userCount = await tx.userDepartment.count({ where: { departmentId: id } });
      return this.shapeDepartment(dept, userCount);
    });
  }

  async toggleDepartment(actor: Actor, id: string) {
    assertCan(actor.role, 'admin:settings');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.department.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Department not found');
      const dept = await tx.department.update({
        where: { id },
        data: { isActive: !existing.isActive },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: dept.isActive ? 'ACTIVATE' : 'DEACTIVATE',
        entityType: 'Department',
        entityId: id,
      });
      const userCount = await tx.userDepartment.count({ where: { departmentId: id } });
      return this.shapeDepartment(dept, userCount);
    });
  }

  async deleteDepartment(actor: Actor, id: string) {
    assertCan(actor.role, 'admin:settings');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.department.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Department not found');

      const [visits, admissions, staff] = await Promise.all([
        tx.visit.count({ where: { departmentId: id } }),
        tx.admission.count({ where: { departmentId: id } }),
        tx.userDepartment.count({ where: { departmentId: id } }),
      ]);
      if (visits + admissions + staff > 0) {
        throw IN_USE(
          'This department is in use by visits, admissions or staff. Deactivate it instead.',
        );
      }

      await tx.department.delete({ where: { id } });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'DELETE',
        entityType: 'Department',
        entityId: id,
        metadata: { name: existing.name },
      });
      return { ok: true };
    });
  }

  private shapeDepartment(d: any, userCount: number) {
    return {
      id: d.id,
      name: d.name,
      code: d.code,
      phone: d.phone,
      notes: d.notes,
      isActive: d.isActive,
      userCount,
    };
  }

  private async assertDepartmentNameFree(tx: Prisma.TransactionClient, tenantId: string, name: string) {
    const clash = await tx.department.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        message: 'A department with this name already exists',
        code: 'NAME_IN_USE',
      });
    }
  }

  // ──────────────────────────────── Services ─────────────────────────────────

  async listServices(tenantId: string, q: ListQueryDto) {
    const page = pageOf(q);
    const isActive = activeFilter(q.status);
    return this.prisma.forTenant(tenantId, async (tx) => {
      const where: Prisma.ServiceItemWhereInput = {};
      if (isActive !== undefined) where.isActive = isActive;
      if (q.category) where.category = { equals: q.category, mode: 'insensitive' };
      if (q.search) {
        where.OR = [
          { name: { contains: q.search, mode: 'insensitive' } },
          { code: { contains: q.search, mode: 'insensitive' } },
        ];
      }

      const [total, rows] = await Promise.all([
        tx.serviceItem.count({ where }),
        tx.serviceItem.findMany({
          where,
          orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      return {
        page,
        pageSize: PAGE_SIZE,
        total,
        rows: rows.map((s) => this.shapeService(s)),
      };
    });
  }

  async createService(actor: Actor, dto: ServiceItemDto) {
    assertCan(actor.role, 'admin:settings');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      await this.assertServiceNameFree(tx, actor.tenantId, dto.name);
      const item = await tx.serviceItem.create({
        data: {
          tenantId: actor.tenantId,
          name: dto.name,
          code: dto.code || null,
          category: dto.category || null,
          unitPrice: new Prisma.Decimal(dto.unitPrice),
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'ServiceItem',
        entityId: item.id,
        metadata: { name: item.name, unitPrice: item.unitPrice.toString() },
      });
      return this.shapeService(item);
    });
  }

  async updateService(actor: Actor, id: string, dto: UpdateServiceItemDto) {
    assertCan(actor.role, 'admin:settings');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.serviceItem.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Service not found');
      if (dto.name && dto.name !== existing.name) {
        await this.assertServiceNameFree(tx, actor.tenantId, dto.name);
      }
      const item = await tx.serviceItem.update({
        where: { id },
        data: {
          name: dto.name ?? undefined,
          code: dto.code !== undefined ? dto.code || null : undefined,
          category: dto.category !== undefined ? dto.category || null : undefined,
          unitPrice: dto.unitPrice !== undefined ? new Prisma.Decimal(dto.unitPrice) : undefined,
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'UPDATE',
        entityType: 'ServiceItem',
        entityId: id,
      });
      return this.shapeService(item);
    });
  }

  async toggleService(actor: Actor, id: string) {
    assertCan(actor.role, 'admin:settings');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.serviceItem.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Service not found');
      const item = await tx.serviceItem.update({
        where: { id },
        data: { isActive: !existing.isActive },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: item.isActive ? 'ACTIVATE' : 'DEACTIVATE',
        entityType: 'ServiceItem',
        entityId: id,
      });
      return this.shapeService(item);
    });
  }

  async deleteService(actor: Actor, id: string) {
    assertCan(actor.role, 'admin:settings');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.serviceItem.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Service not found');

      const [lines, orders] = await Promise.all([
        tx.invoiceLine.count({ where: { serviceItemId: id } }),
        tx.clinicalOrder.count({ where: { serviceItemId: id } }),
      ]);
      if (lines + orders > 0) {
        throw IN_USE(
          'This service has been billed or ordered. Deactivate it instead.',
        );
      }

      await tx.serviceItem.delete({ where: { id } });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'DELETE',
        entityType: 'ServiceItem',
        entityId: id,
        metadata: { name: existing.name },
      });
      return { ok: true };
    });
  }

  private shapeService(s: any) {
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      category: s.category,
      unitPrice: s.unitPrice.toString(),
      isActive: s.isActive,
    };
  }

  private async assertServiceNameFree(tx: Prisma.TransactionClient, tenantId: string, name: string) {
    const clash = await tx.serviceItem.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        message: 'A service with this name already exists',
        code: 'NAME_IN_USE',
      });
    }
  }

  // ─────────────────────────── Insurance providers ───────────────────────────

  async listProviders(tenantId: string, q: ListQueryDto) {
    const page = pageOf(q);
    const isActive = activeFilter(q.status);
    return this.prisma.forTenant(tenantId, async (tx) => {
      const where: Prisma.InsuranceProviderWhereInput = {};
      if (isActive !== undefined) where.isActive = isActive;
      if (q.kind && this.isKind(q.kind)) where.kind = q.kind;
      if (q.search) {
        where.OR = [
          { name: { contains: q.search, mode: 'insensitive' } },
          { contactPerson: { contains: q.search, mode: 'insensitive' } },
        ];
      }

      const [total, rows] = await Promise.all([
        tx.insuranceProvider.count({ where }),
        tx.insuranceProvider.findMany({
          where,
          orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      const withCounts = await Promise.all(
        rows.map(async (p) => {
          const patientCount = await tx.patient.count({
            where: {
              OR: [
                { hmoName: { equals: p.name, mode: 'insensitive' } },
                { insuranceProvider: { equals: p.name, mode: 'insensitive' } },
              ],
            },
          });
          return this.shapeProvider(p, patientCount);
        }),
      );

      return { page, pageSize: PAGE_SIZE, total, rows: withCounts };
    });
  }

  async providerOptions(tenantId: string, kind?: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.insuranceProvider
        .findMany({
          where: { isActive: true, ...(kind && this.isKind(kind) ? { kind } : {}) },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, kind: true },
        })
        .then((rows) => rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind }))),
    );
  }

  async createProvider(actor: Actor, dto: InsuranceProviderDto) {
    assertCan(actor.role, 'admin:settings');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      await this.assertProviderNameFree(tx, actor.tenantId, dto.name);
      const provider = await tx.insuranceProvider.create({
        data: {
          tenantId: actor.tenantId,
          name: dto.name,
          kind: dto.kind,
          phone: dto.phone || null,
          email: dto.email || null,
          address: dto.address || null,
          contactPerson: dto.contactPerson || null,
          notes: dto.notes || null,
          createdById: actor.userId,
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'InsuranceProvider',
        entityId: provider.id,
        metadata: { name: provider.name, kind: provider.kind },
      });
      return this.shapeProvider(provider, 0);
    });
  }

  async updateProvider(actor: Actor, id: string, dto: UpdateInsuranceProviderDto) {
    assertCan(actor.role, 'admin:settings');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.insuranceProvider.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Provider not found');
      if (dto.name && dto.name !== existing.name) {
        await this.assertProviderNameFree(tx, actor.tenantId, dto.name);
      }
      const provider = await tx.insuranceProvider.update({
        where: { id },
        data: {
          name: dto.name ?? undefined,
          kind: dto.kind ?? undefined,
          phone: dto.phone !== undefined ? dto.phone || null : undefined,
          email: dto.email !== undefined ? dto.email || null : undefined,
          address: dto.address !== undefined ? dto.address || null : undefined,
          contactPerson: dto.contactPerson !== undefined ? dto.contactPerson || null : undefined,
          notes: dto.notes !== undefined ? dto.notes || null : undefined,
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'UPDATE',
        entityType: 'InsuranceProvider',
        entityId: id,
      });
      const patientCount = await this.providerPatientCount(tx, provider.name);
      return this.shapeProvider(provider, patientCount);
    });
  }

  async toggleProvider(actor: Actor, id: string) {
    assertCan(actor.role, 'admin:settings');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.insuranceProvider.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Provider not found');
      const provider = await tx.insuranceProvider.update({
        where: { id },
        data: { isActive: !existing.isActive },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: provider.isActive ? 'ACTIVATE' : 'DEACTIVATE',
        entityType: 'InsuranceProvider',
        entityId: id,
      });
      const patientCount = await this.providerPatientCount(tx, provider.name);
      return this.shapeProvider(provider, patientCount);
    });
  }

  async deleteProvider(actor: Actor, id: string) {
    assertCan(actor.role, 'admin:settings');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.insuranceProvider.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Provider not found');
      await tx.insuranceProvider.delete({ where: { id } });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'DELETE',
        entityType: 'InsuranceProvider',
        entityId: id,
        metadata: { name: existing.name },
      });
      return { ok: true };
    });
  }

  private isKind(value: string): value is InsuranceKind {
    return (Object.values(InsuranceKind) as string[]).includes(value);
  }

  private providerPatientCount(tx: Prisma.TransactionClient, name: string) {
    return tx.patient.count({
      where: {
        OR: [
          { hmoName: { equals: name, mode: 'insensitive' } },
          { insuranceProvider: { equals: name, mode: 'insensitive' } },
        ],
      },
    });
  }

  private shapeProvider(p: any, patientCount: number) {
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      phone: p.phone,
      email: p.email,
      address: p.address,
      contactPerson: p.contactPerson,
      notes: p.notes,
      isActive: p.isActive,
      patientCount,
    };
  }

  private async assertProviderNameFree(tx: Prisma.TransactionClient, tenantId: string, name: string) {
    const clash = await tx.insuranceProvider.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        message: 'A provider with this name already exists',
        code: 'NAME_IN_USE',
      });
    }
  }
}
