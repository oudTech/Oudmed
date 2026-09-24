import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AccessLevel = 'FULL' | 'READ_ONLY';

/**
 * A hospital gets 3 days past its trial/period end before write access is
 * restricted - long enough to absorb a slow card retry or a late bank
 * transfer without interrupting patient care over a timing issue.
 */
const GRACE_DAYS = 3;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

/**
 * READ_ONLY never means locked out of the app - existing patient records,
 * charts and invoices stay visible; only creating/editing is blocked. This
 * is deliberately lazy (computed per request from stored dates), not a cron
 * job flipping status - there is no background job runner in this codebase,
 * and a lazily-computed access level can never drift from what the dates
 * actually say.
 */
@Injectable()
export class EntitlementsService {
  private readonly log = new Logger(EntitlementsService.name);

  constructor(private prisma: PrismaService) {}

  async getAccessLevel(tenantId: string): Promise<AccessLevel> {
    try {
      const sub = await this.prisma.forTenant(tenantId, (tx) => tx.subscription.findUnique({ where: { tenantId } }));
      // No subscription row should never happen (every tenant gets one at
      // sign-up), but this is a security-adjacent check - fail open rather
      // than accidentally locking out every write in the app on a data gap.
      if (!sub) return 'FULL';

      if (sub.status === 'SUSPENDED' || sub.status === 'CANCELLED') return 'READ_ONLY';

      const now = Date.now();
      if (sub.status === 'TRIALING') {
        return now > sub.trialEndsAt.getTime() + GRACE_MS ? 'READ_ONLY' : 'FULL';
      }
      // ACTIVE / PAST_DUE: only enforceable once a period end actually exists.
      if (sub.currentPeriodEnd && now > sub.currentPeriodEnd.getTime() + GRACE_MS) return 'READ_ONLY';
      return 'FULL';
    } catch (err) {
      // A transient DB hiccup must never turn into an app-wide write outage -
      // fail open and let the next request try again.
      this.log.warn(`getAccessLevel failed for tenant ${tenantId}, failing open: ${(err as Error)?.message}`);
      return 'FULL';
    }
  }
}
