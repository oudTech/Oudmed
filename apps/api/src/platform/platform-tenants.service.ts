import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { PlatformPricingDTO } from '@oudhealth/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAuditService } from '../common/audit/platform-audit.service';
import { toCsv } from '../common/csv';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { RESERVED_SLUGS, slugify } from '../tenants/tenants.service';
import { CreateTenantDirectDto } from './dto/create-tenant-direct.dto';
import { ListTenantsQueryDto } from './dto/list-tenants-query.dto';

const PAGE_SIZE = 25;
const money = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v).toFixed(2);

/**
 * Cross-tenant reads always go tenant-by-tenant (see RenewalService's own
 * comment on this): Subscription/SubscriptionInvoice are RLS-protected and the
 * app's DB role cannot bypass that even from a platform-operator request.
 * Tenant volume is low enough today that this is a straightforward loop, not a
 * batched/cached aggregate - the same judgment call RenewalService's crons
 * already made.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    private prisma: PrismaService,
    private subscriptions: SubscriptionsService,
    private audit: PlatformAuditService,
  ) {}

  private async tenantRow(tenant: Tenant, pricing: PlatformPricingDTO) {
    const [[sub, patientCount, lastLogin], seats] = await Promise.all([
      this.prisma.forTenant(tenant.id, (tx) =>
        Promise.all([
          tx.subscription.findUnique({ where: { tenantId: tenant.id } }),
          tx.patient.count(),
          tx.user.aggregate({ where: { tenantId: tenant.id }, _max: { lastLoginAt: true } }),
        ]),
      ),
      this.subscriptions.seatBreakdown(tenant.id, pricing),
    ]);

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logoUrl,
      contactEmail: tenant.contactEmail,
      address: tenant.address,
      isActive: tenant.isActive,
      subscriptionStatus: sub?.status ?? 'TRIALING',
      trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
      users: seats.adminSeats + seats.otherSeats,
      patients: patientCount,
      monthlyRevenue: seats.monthlyGross,
      lastActivityAt: lastLogin._max.lastLoginAt?.toISOString() ?? null,
      joinedAt: tenant.createdAt.toISOString(),
    };
  }

  /** Unfiltered, unpaginated - used by the overview/activity aggregates. */
  async allSummaries() {
    const pricing = await this.subscriptions.getPricing();
    const tenants = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
    return Promise.all(tenants.map((t) => this.tenantRow(t, pricing)));
  }

  /** Shared by the paginated list and the CSV export, so both always agree on what "matches the current filters" means. */
  private async filteredRows(q: { search?: string; status?: string }) {
    const pricing = await this.subscriptions.getPricing();
    const where: Prisma.TenantWhereInput = {};
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { slug: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const tenants = await this.prisma.tenant.findMany({ where, orderBy: { createdAt: 'desc' } });
    const rows = await Promise.all(tenants.map((t) => this.tenantRow(t, pricing)));
    return q.status && q.status !== 'all'
      ? rows.filter((r) => r.subscriptionStatus.toLowerCase() === q.status)
      : rows;
  }

  async listTenants(q: ListTenantsQueryDto) {
    const page = q.page && q.page > 0 ? q.page : 1;
    const filtered = await this.filteredRows(q);
    return {
      page,
      pageSize: PAGE_SIZE,
      total: filtered.length,
      rows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    };
  }

  /**
   * Every hospital matching the current search/status filters, as CSV - the
   * exact same fields already shown in the All Hospitals table, no new ones.
   */
  async exportCsv(q: { search?: string; status?: string }): Promise<string> {
    const filtered = await this.filteredRows(q);
    const header = ['Hospital', 'Status', 'Users', 'Patients', 'Monthly revenue (NGN)', 'Last activity', 'Joined'];
    const rows = filtered.map((r) => [
      r.name,
      r.isActive ? r.subscriptionStatus : 'SUSPENDED',
      String(r.users),
      String(r.patients),
      r.monthlyRevenue,
      r.lastActivityAt ?? '',
      r.joinedAt,
    ]);
    return toCsv([header, ...rows]);
  }

  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Hospital not found');
    const pricing = await this.subscriptions.getPricing();
    const [row, invoices] = await Promise.all([
      this.tenantRow(tenant, pricing),
      this.prisma.forTenant(id, (tx) =>
        tx.subscriptionInvoice.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 25 }),
      ),
    ]);

    return {
      ...row,
      invoices: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        billingCycle: inv.billingCycle,
        totalAmount: money(inv.totalAmount),
        currency: inv.currency,
        status: inv.status,
        paymentMethod: inv.paymentMethod,
        paidAt: inv.paidAt?.toISOString() ?? null,
        createdAt: inv.createdAt.toISOString(),
      })),
    };
  }

  async createTenant(platformUserId: string, dto: CreateTenantDirectDto) {
    const slug = await this.generateSlug(dto.name);
    const passwordHash = await bcrypt.hash(dto.adminPassword, 12);

    const { tenant, user } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.name, slug, address: dto.address, contactEmail: dto.adminEmail },
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.adminEmail,
          passwordHash,
          fullName: dto.adminFullName,
          role: 'HOSPITAL_ADMIN',
          // A platform operator creating the account directly is itself the
          // verification - there is no PendingRegistration/email-verify step here.
          emailVerifiedAt: new Date(),
        },
      });
      await this.subscriptions.startTrial(tx, tenant.id);
      return { tenant, user };
    });

    await this.audit.record({
      platformUserId,
      tenantId: tenant.id,
      action: 'CREATE',
      entityType: 'Tenant',
      entityId: tenant.id,
      metadata: { name: tenant.name, slug: tenant.slug, adminEmail: user.email },
    });

    return this.getTenant(tenant.id);
  }

  async suspend(platformUserId: string, id: string) {
    const tenant = await this.mustFind(id);
    await this.prisma.tenant.update({ where: { id }, data: { isActive: false } });
    await this.audit.record({
      platformUserId,
      tenantId: id,
      action: 'SUSPEND',
      entityType: 'Tenant',
      entityId: id,
      metadata: { name: tenant.name },
    });
    return this.getTenant(id);
  }

  async reactivate(platformUserId: string, id: string) {
    const tenant = await this.mustFind(id);
    await this.prisma.tenant.update({ where: { id }, data: { isActive: true } });
    await this.audit.record({
      platformUserId,
      tenantId: id,
      action: 'REACTIVATE',
      entityType: 'Tenant',
      entityId: id,
      metadata: { name: tenant.name },
    });
    return this.getTenant(id);
  }

  private async mustFind(id: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Hospital not found');
    return tenant;
  }

  private async generateSlug(name: string): Promise<string> {
    const base = slugify(name) || 'hospital';
    let candidate = RESERVED_SLUGS.has(base) ? `${base}-hospital` : base;
    for (let i = 0; i < 50; i++) {
      const taken = await this.prisma.tenant.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
      candidate = `${base}-${i + 2}`;
    }
    throw new ConflictException('Could not generate an available workspace address');
  }
}
