import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformTenantsService } from './platform-tenants.service';

const PAGE_SIZE = 25;
const money = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v).toFixed(2);

function describeActivity(entry: { action: string; entityType: string }, operator: string, tenant?: string): string {
  switch (`${entry.entityType}:${entry.action}`) {
    case 'Tenant:CREATE':
      return `${tenant ?? 'A hospital'} was created by ${operator}`;
    case 'Tenant:SUSPEND':
      return `${tenant ?? 'A hospital'} was suspended by ${operator}`;
    case 'Tenant:REACTIVATE':
      return `${tenant ?? 'A hospital'} was reactivated by ${operator}`;
    case 'PlatformPricing:UPDATE':
      return `${operator} updated platform pricing`;
    case 'PlatformConfig:UPDATE':
      return `${operator} updated platform settings`;
    case 'PlatformConfig:MAINTENANCE_ON':
      return `${operator} enabled maintenance mode`;
    case 'PlatformConfig:MAINTENANCE_OFF':
      return `${operator} disabled maintenance mode`;
    case 'SubscriptionInvoice:CONFIRM_PAYMENT':
      return `${operator} confirmed a payment for ${tenant ?? 'a hospital'}`;
    case 'PlatformUser:CREATE':
      return `${operator} added a new platform user`;
    case 'PlatformUser:DEACTIVATE':
      return `${operator} deactivated a platform user`;
    default:
      return `${operator} performed ${entry.action.toLowerCase()} on ${entry.entityType}${tenant ? ` for ${tenant}` : ''}`;
  }
}

/**
 * Reads that power the Overview and Platform Activity screens. Tenant-level
 * numbers are sourced from PlatformTenantsService.allSummaries() rather than
 * re-walking tenants here, so the "N hospitals trialing" count on Overview and
 * the row in All Hospitals never disagree.
 */
@Injectable()
export class PlatformOverviewService {
  constructor(
    private prisma: PrismaService,
    private tenants: PlatformTenantsService,
  ) {}

  async overview() {
    const summaries = await this.tenants.allSummaries();

    const statusCounts: Record<string, number> = {
      TRIALING: 0,
      ACTIVE: 0,
      PAST_DUE: 0,
      SUSPENDED: 0,
      CANCELLED: 0,
    };
    let estimatedMonthlyRevenue = new Prisma.Decimal(0);
    let newThisMonth = 0;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    for (const s of summaries) {
      statusCounts[s.subscriptionStatus] = (statusCounts[s.subscriptionStatus] ?? 0) + 1;
      if (s.subscriptionStatus !== 'CANCELLED') {
        estimatedMonthlyRevenue = estimatedMonthlyRevenue.add(s.monthlyRevenue);
      }
      if (new Date(s.joinedAt) >= startOfMonth) newThisMonth += 1;
    }

    return {
      totalHospitals: summaries.length,
      newThisMonth,
      statusCounts,
      estimatedMonthlyRevenue: money(estimatedMonthlyRevenue),
      revenueTrend: await this.revenueTrend(),
    };
  }

  private async revenueTrend(months = 6) {
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const monthKeys: string[] = [];
    const totals = new Map<string, Prisma.Decimal>();
    for (let i = 0; i < months; i++) {
      const d = new Date(since);
      d.setMonth(d.getMonth() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthKeys.push(key);
      totals.set(key, new Prisma.Decimal(0));
    }

    const tenantIds = (await this.prisma.tenant.findMany({ select: { id: true } })).map((t) => t.id);
    for (const tenantId of tenantIds) {
      const invoices = await this.prisma.forTenant(tenantId, (tx) =>
        tx.subscriptionInvoice.findMany({
          where: { tenantId, status: 'PAID', paidAt: { gte: since } },
          select: { totalAmount: true, paidAt: true },
        }),
      );
      for (const inv of invoices) {
        if (!inv.paidAt) continue;
        const key = `${inv.paidAt.getFullYear()}-${String(inv.paidAt.getMonth() + 1).padStart(2, '0')}`;
        const current = totals.get(key);
        if (current) totals.set(key, current.add(inv.totalAmount));
      }
    }

    return monthKeys.map((month) => ({ month, total: money(totals.get(month) ?? 0) }));
  }

  async activity(page = 1) {
    const [total, rows] = await Promise.all([
      this.prisma.platformAuditLog.count(),
      this.prisma.platformAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    const operatorIds = [...new Set(rows.map((r) => r.platformUserId).filter((v): v is string => !!v))];
    const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter((v): v is string => !!v))];
    const [operators, tenants] = await Promise.all([
      operatorIds.length
        ? this.prisma.platformUser.findMany({ where: { id: { in: operatorIds } }, select: { id: true, fullName: true } })
        : Promise.resolve([]),
      tenantIds.length
        ? this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const operatorName = new Map(operators.map((o) => [o.id, o.fullName]));
    const tenantName = new Map(tenants.map((t) => [t.id, t.name]));

    return {
      page,
      pageSize: PAGE_SIZE,
      total,
      rows: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        createdAt: r.createdAt.toISOString(),
        message: describeActivity(
          r,
          (r.platformUserId && operatorName.get(r.platformUserId)) || 'A platform operator',
          (r.tenantId && tenantName.get(r.tenantId)) || undefined,
        ),
      })),
    };
  }
}
