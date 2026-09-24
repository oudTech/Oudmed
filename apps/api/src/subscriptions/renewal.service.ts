import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { tenantUrl } from '../common/urls';
import { SubscriptionsService } from './subscriptions.service';
import { EntitlementsService } from './entitlements.service';

type TenantRow = { id: string; name: string; slug: string; contactEmail: string | null };

/**
 * The three time-based jobs subscriptions need, none of which can be triggered
 * by a request: auto-renewal, trial-ending reminders, read-only notices.
 *
 * Requires an always-on Render plan to fire reliably - a free-tier instance
 * that has spun down from idle simply does not run until the next request
 * wakes it, so these jobs would silently skip days. Fine pre-launch; must be
 * confirmed once real hospitals depend on it.
 *
 * Every job iterates tenants one at a time via `forTenant`, never a bare
 * cross-tenant query - Subscription is RLS-protected and the app's DB
 * connection cannot bypass that (see rls.sql), by design, even from a
 * background job. Tenant is not RLS-protected, so listing tenants directly is
 * fine; only the per-tenant Subscription/SubscriptionInvoice reads need it.
 */
@Injectable()
export class RenewalService {
  private readonly log = new Logger(RenewalService.name);

  constructor(
    private prisma: PrismaService,
    private subscriptions: SubscriptionsService,
    private entitlements: EntitlementsService,
    private email: EmailService,
  ) {}

  private async activeTenants(): Promise<TenantRow[]> {
    return this.prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true, contactEmail: true },
    });
  }

  @Cron('0 6 * * *')
  async processRenewals(): Promise<void> {
    const tenants = await this.activeTenants();
    for (const tenant of tenants) {
      await this.subscriptions
        .attemptAutoRenewal(tenant.id)
        .catch((err) => this.log.error(`renewal check failed for tenant ${tenant.id}: ${(err as Error)?.message}`));
    }
  }

  @Cron('0 7 * * *')
  async sendTrialEndingReminders(): Promise<void> {
    const tenants = await this.activeTenants();
    for (const tenant of tenants) {
      await this.checkTrialReminder(tenant).catch((err) =>
        this.log.error(`trial reminder check failed for tenant ${tenant.id}: ${(err as Error)?.message}`),
      );
    }
  }

  private async checkTrialReminder(tenant: TenantRow): Promise<void> {
    const sub = await this.prisma.forTenant(tenant.id, (tx) => tx.subscription.findUnique({ where: { tenantId: tenant.id } }));
    if (!sub || sub.status !== 'TRIALING' || sub.trialEndingReminderSentAt || !tenant.contactEmail) return;

    const daysLeft = Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    // Send once, in a 0-3 day window before the trial actually ends - not
    // after, that is what the read-only notice below is for.
    if (daysLeft > 3 || daysLeft < 0) return;

    await this.email.sendTrialEndingSoon(tenant.contactEmail, tenant.name, Math.max(daysLeft, 0), `${tenantUrl(tenant.slug)}/settings`);
    await this.prisma.forTenant(tenant.id, (tx) =>
      tx.subscription.update({ where: { id: sub.id }, data: { trialEndingReminderSentAt: new Date() } }),
    );
  }

  @Cron('0 8 * * *')
  async sendReadOnlyNotices(): Promise<void> {
    const tenants = await this.activeTenants();
    for (const tenant of tenants) {
      await this.checkReadOnlyNotice(tenant).catch((err) =>
        this.log.error(`read-only notice check failed for tenant ${tenant.id}: ${(err as Error)?.message}`),
      );
    }
  }

  private async checkReadOnlyNotice(tenant: TenantRow): Promise<void> {
    const sub = await this.prisma.forTenant(tenant.id, (tx) => tx.subscription.findUnique({ where: { tenantId: tenant.id } }));
    if (!sub || sub.readOnlyNoticeSentAt || !tenant.contactEmail) return;

    const access = await this.entitlements.getAccessLevel(tenant.id);
    if (access !== 'READ_ONLY') return;

    await this.email.sendReadOnlyNotice(tenant.contactEmail, tenant.name, `${tenantUrl(tenant.slug)}/settings`);
    await this.prisma.forTenant(tenant.id, (tx) =>
      tx.subscription.update({ where: { id: sub.id }, data: { readOnlyNoticeSentAt: new Date() } }),
    );
  }
}
