import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import type {
  CardCheckoutResultDTO,
  PlatformPricingDTO,
  SeatBreakdownDTO,
  SubscriptionInvoiceDTO,
  SubscriptionSummaryDTO,
} from '@oudhealth/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { assertCan } from '../common/permissions';
import { nextPlatformSequence } from '../common/sequence';
import { tenantUrl } from '../common/urls';
import { PaystackClient } from './paystack.client';
import { UpdatePlatformPricingDto } from './dto/update-pricing.dto';
import { CheckoutDto } from './dto/checkout.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

type Cycle = 'MONTHLY' | 'ANNUAL';

const money = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v).toFixed(2);

@Injectable()
export class SubscriptionsService {
  private readonly log = new Logger(SubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private paystack: PaystackClient,
  ) {}

  // ── pricing ──

  /**
   * There is exactly one pricing row; PlatformPricing is not tenant-scoped (see
   * schema comment). Callers never need more than "the current price."
   */
  private async pricingRow() {
    const row = await this.prisma.platformPricing.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!row) throw new NotFoundException('Platform pricing has not been configured');
    return row;
  }

  private toPricingDto(row: {
    currency: string;
    adminSeatPriceMonthly: Prisma.Decimal;
    otherSeatPriceMonthly: Prisma.Decimal;
    annualDiscountPct: Prisma.Decimal;
    vatPct: Prisma.Decimal;
    platformTin: string | null;
    trialDays: number;
  }): PlatformPricingDTO {
    return {
      currency: row.currency,
      adminSeatPriceMonthly: money(row.adminSeatPriceMonthly),
      otherSeatPriceMonthly: money(row.otherSeatPriceMonthly),
      annualDiscountPct: row.annualDiscountPct.toFixed(2),
      vatPct: row.vatPct.toFixed(2),
      platformTin: row.platformTin,
      trialDays: row.trialDays,
    };
  }

  /** Public - a future pricing page and the in-app billing view both read this. */
  async getPricing(): Promise<PlatformPricingDTO> {
    return this.toPricingDto(await this.pricingRow());
  }

  /**
   * Gated by PlatformAuthGuard at the controller (a genuine platform operator,
   * not a hospital's own SUPER_ADMIN - see platform-auth). No fine-grained
   * platform permission matrix yet since there is only one operator today;
   * being a valid, active PlatformUser is the whole check.
   *
   * Not logged to AuditLog: that table requires a tenantId and this action has
   * none - forcing a sentinel value in would pollute tenant-scoped audit data
   * with a platform event. A dedicated PlatformAuditLog is real future work;
   * for now this is visible in the service logs, which is more than nothing
   * but not the durable trail a money-affecting change like this deserves.
   */
  async updatePricing(platformUserId: string, dto: UpdatePlatformPricingDto): Promise<PlatformPricingDTO> {
    const current = await this.pricingRow();
    const data: Prisma.PlatformPricingUpdateInput = {};
    if (dto.adminSeatPriceMonthly !== undefined) data.adminSeatPriceMonthly = new Prisma.Decimal(dto.adminSeatPriceMonthly);
    if (dto.otherSeatPriceMonthly !== undefined) data.otherSeatPriceMonthly = new Prisma.Decimal(dto.otherSeatPriceMonthly);
    if (dto.annualDiscountPct !== undefined) data.annualDiscountPct = new Prisma.Decimal(dto.annualDiscountPct);
    if (dto.vatPct !== undefined) data.vatPct = new Prisma.Decimal(dto.vatPct);
    if (dto.platformTin !== undefined) data.platformTin = dto.platformTin;
    if (dto.trialDays !== undefined) data.trialDays = dto.trialDays;
    if (dto.currency !== undefined) data.currency = dto.currency;
    data.updatedById = platformUserId;

    const updated = await this.prisma.platformPricing.update({ where: { id: current.id }, data });
    this.log.log(
      `PlatformPricing updated by platform user ${platformUserId}: ${JSON.stringify({ before: this.toPricingDto(current), after: this.toPricingDto(updated) })}`,
    );
    return this.toPricingDto(updated);
  }

  // ── trial / seats ──

  /**
   * Called from inside TenantsService's own create transaction, so a new
   * tenant never exists without a subscription row even for an instant.
   * Subscription is RLS-protected but that transaction is not opened via
   * `forTenant` (the tenant doesn't exist yet when it starts) - `app.tenant_id`
   * is set here so the insert's RLS check passes regardless of what the caller
   * already did.
   */
  async startTrial(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
    const pricing = await this.pricingRow();
    const trialEndsAt = new Date(Date.now() + pricing.trialDays * 24 * 60 * 60 * 1000);
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx.subscription.create({ data: { tenantId, trialEndsAt } });
  }

  /**
   * Active-user seat count by role, priced against the current PlatformPricing,
   * net and VAT-inclusive for both cycles. User is not an RLS table (see
   * rls.sql) - the tenantId filter must be explicit here, the same pattern
   * staff.service.ts and me.service.ts use.
   */
  async seatBreakdown(tenantId: string, pricing?: PlatformPricingDTO): Promise<SeatBreakdownDTO> {
    const p = pricing ?? (await this.getPricing());
    const counts = await this.prisma.user.groupBy({
      by: ['role'],
      where: { tenantId, isActive: true },
      _count: true,
    });
    const adminSeats = counts.find((c) => c.role === Role.HOSPITAL_ADMIN)?._count ?? 0;
    const otherSeats = counts.filter((c) => c.role !== Role.HOSPITAL_ADMIN).reduce((sum, c) => sum + c._count, 0);

    const monthlyNet = new Prisma.Decimal(p.adminSeatPriceMonthly)
      .mul(adminSeats)
      .add(new Prisma.Decimal(p.otherSeatPriceMonthly).mul(otherSeats));
    const annualNet = monthlyNet.mul(12).mul(new Prisma.Decimal(100).sub(p.annualDiscountPct)).div(100);
    const vatPct = new Prisma.Decimal(p.vatPct);
    const monthlyVat = monthlyNet.mul(vatPct).div(100);
    const annualVat = annualNet.mul(vatPct).div(100);

    return {
      adminSeats,
      otherSeats,
      monthlyNet: money(monthlyNet),
      monthlyVat: money(monthlyVat),
      monthlyGross: money(monthlyNet.add(monthlyVat)),
      annualNet: money(annualNet),
      annualVat: money(annualVat),
      annualGross: money(annualNet.add(annualVat)),
    };
  }

  async getMySubscription(tenantId: string): Promise<SubscriptionSummaryDTO> {
    const [sub, pricing] = await Promise.all([
      this.prisma.forTenant(tenantId, (tx) => tx.subscription.findUnique({ where: { tenantId } })),
      this.getPricing(),
    ]);
    if (!sub) throw new NotFoundException('No subscription found for this hospital');
    const seats = await this.seatBreakdown(tenantId, pricing);

    const trialDaysRemaining =
      sub.status === 'TRIALING'
        ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
        : null;

    return {
      status: sub.status,
      billingCycle: sub.billingCycle,
      trialEndsAt: sub.trialEndsAt.toISOString(),
      trialDaysRemaining,
      currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      pricing,
      seats,
    };
  }

  // ── invoices / payment ──

  private toInvoiceDto(row: {
    id: string;
    invoiceNumber: string;
    billingCycle: string;
    netAmount: Prisma.Decimal;
    vatAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    currency: string;
    status: string;
    paymentMethod: string;
    paidAt: Date | null;
    createdAt: Date;
  }): SubscriptionInvoiceDTO {
    return {
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      billingCycle: row.billingCycle as SubscriptionInvoiceDTO['billingCycle'],
      netAmount: money(row.netAmount),
      vatAmount: money(row.vatAmount),
      totalAmount: money(row.totalAmount),
      currency: row.currency,
      status: row.status as SubscriptionInvoiceDTO['status'],
      paymentMethod: row.paymentMethod as SubscriptionInvoiceDTO['paymentMethod'],
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** "SUB-000001" - a platform-level gapless counter, see common/sequence.ts. */
  private async generateInvoiceNumber(): Promise<string> {
    const n = await this.prisma.$transaction((tx) => nextPlatformSequence(tx, 'subscriptionInvoice'));
    return `SUB-${String(n).padStart(6, '0')}`;
  }

  private async createPendingInvoice(
    tenantId: string,
    subscriptionId: string,
    billingCycle: Cycle,
    paymentMethod: 'CARD' | 'BANK_TRANSFER',
  ) {
    const pricing = await this.getPricing();
    const seats = await this.seatBreakdown(tenantId, pricing);
    const net = billingCycle === 'MONTHLY' ? seats.monthlyNet : seats.annualNet;
    const vat = billingCycle === 'MONTHLY' ? seats.monthlyVat : seats.annualVat;
    const gross = billingCycle === 'MONTHLY' ? seats.monthlyGross : seats.annualGross;
    const invoiceNumber = await this.generateInvoiceNumber();

    return this.prisma.forTenant(tenantId, (tx) =>
      tx.subscriptionInvoice.create({
        data: {
          tenantId,
          subscriptionId,
          invoiceNumber,
          billingCycle,
          netAmount: new Prisma.Decimal(net),
          vatAmount: new Prisma.Decimal(vat),
          totalAmount: new Prisma.Decimal(gross),
          currency: pricing.currency,
          paymentMethod,
          // Paystack accepts a caller-supplied reference and echoes it back
          // verbatim, including in the webhook - using the invoice number
          // directly means no extra round trip to record it after the fact.
          paystackReference: paymentMethod === 'CARD' ? invoiceNumber : null,
        },
      }),
    );
  }

  private async activateSubscription(tenantId: string, subscriptionId: string, billingCycle: Cycle): Promise<void> {
    const now = new Date();
    const periodEnd = new Date(now);
    if (billingCycle === 'MONTHLY') periodEnd.setMonth(periodEnd.getMonth() + 1);
    else periodEnd.setFullYear(periodEnd.getFullYear() + 1);

    await this.prisma.forTenant(tenantId, (tx) =>
      tx.subscription.update({
        where: { id: subscriptionId },
        data: { status: 'ACTIVE', billingCycle, currentPeriodStart: now, currentPeriodEnd: periodEnd },
      }),
    );
  }

  async listMyInvoices(tenantId: string): Promise<SubscriptionInvoiceDTO[]> {
    const rows = await this.prisma.forTenant(tenantId, (tx) =>
      tx.subscriptionInvoice.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
    );
    return rows.map((r) => this.toInvoiceDto(r));
  }

  async initiateCardCheckout(actor: Actor, dto: CheckoutDto): Promise<CardCheckoutResultDTO> {
    assertCan(actor.role, 'admin:settings');
    const [sub, user, tenant] = await Promise.all([
      this.prisma.forTenant(actor.tenantId, (tx) => tx.subscription.findUnique({ where: { tenantId: actor.tenantId } })),
      this.prisma.user.findUnique({ where: { id: actor.userId }, select: { email: true } }),
      this.prisma.tenant.findUnique({ where: { id: actor.tenantId }, select: { slug: true } }),
    ]);
    if (!sub) throw new NotFoundException('No subscription found for this hospital');
    if (!user || !tenant) throw new NotFoundException('Account not found');

    const invoice = await this.createPendingInvoice(actor.tenantId, sub.id, dto.billingCycle, 'CARD');

    const { authorizationUrl, reference } = await this.paystack.initializeTransaction({
      email: user.email,
      amountNaira: Number(invoice.totalAmount),
      reference: invoice.invoiceNumber,
      callbackUrl: `${tenantUrl(tenant.slug)}/settings?checkout=return&reference=${encodeURIComponent(invoice.invoiceNumber)}`,
      metadata: { tenantId: actor.tenantId, subscriptionInvoiceId: invoice.id },
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'CREATE',
      entityType: 'SubscriptionInvoice',
      entityId: invoice.id,
      metadata: { billingCycle: dto.billingCycle, amount: invoice.totalAmount.toString(), method: 'CARD' },
    });

    return { invoiceId: invoice.id, authorizationUrl, reference };
  }

  async initiateBankTransfer(actor: Actor, dto: CheckoutDto): Promise<SubscriptionInvoiceDTO> {
    assertCan(actor.role, 'admin:settings');
    const sub = await this.prisma.forTenant(actor.tenantId, (tx) => tx.subscription.findUnique({ where: { tenantId: actor.tenantId } }));
    if (!sub) throw new NotFoundException('No subscription found for this hospital');

    const invoice = await this.createPendingInvoice(actor.tenantId, sub.id, dto.billingCycle, 'BANK_TRANSFER');
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'CREATE',
      entityType: 'SubscriptionInvoice',
      entityId: invoice.id,
      metadata: { billingCycle: dto.billingCycle, amount: invoice.totalAmount.toString(), method: 'BANK_TRANSFER' },
    });
    return this.toInvoiceDto(invoice);
  }

  /**
   * Optional snappy confirmation for the page the browser lands back on after
   * Paystack's checkout - the webhook remains the authoritative source, this
   * just avoids the customer staring at "pending" if the webhook is briefly
   * delayed. Safe to call repeatedly; a PAID invoice short-circuits.
   */
  async verifyCardCheckout(actor: Actor, reference: string): Promise<SubscriptionInvoiceDTO> {
    const invoice = await this.prisma.forTenant(actor.tenantId, (tx) =>
      tx.subscriptionInvoice.findFirst({ where: { tenantId: actor.tenantId, paystackReference: reference } }),
    );
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'PAID') return this.toInvoiceDto(invoice);

    const result = await this.paystack.verifyTransaction(reference);
    if (result.status === 'success') {
      const updated = await this.prisma.forTenant(actor.tenantId, (tx) =>
        tx.subscriptionInvoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: new Date() } }),
      );
      await this.activateSubscription(actor.tenantId, invoice.subscriptionId, invoice.billingCycle as Cycle);
      return this.toInvoiceDto(updated);
    }
    return this.toInvoiceDto(invoice);
  }

  /**
   * Called only from PlatformSubscriptionsController, gated by PlatformAuthGuard.
   * A genuine platform operator has no tenant of their own (that is the whole
   * point of platform-auth), so which hospital's invoice to confirm is an
   * explicit parameter here, never inferred from the caller's own identity -
   * unlike a hospital-scoped action, there is no "their own tenant" to assume.
   */
  async markInvoicePaidAsPlatform(tenantId: string, invoiceId: string, platformUserId: string): Promise<SubscriptionInvoiceDTO> {
    const invoice = await this.prisma.forTenant(tenantId, (tx) => tx.subscriptionInvoice.findFirst({ where: { id: invoiceId } }));
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.paymentMethod !== 'BANK_TRANSFER') {
      throw new BadRequestException('Only bank-transfer invoices are confirmed manually');
    }
    if (invoice.status === 'PAID') return this.toInvoiceDto(invoice);

    const updated = await this.prisma.forTenant(tenantId, (tx) =>
      tx.subscriptionInvoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID', paidAt: new Date(), markedPaidById: platformUserId },
      }),
    );
    await this.activateSubscription(tenantId, invoice.subscriptionId, invoice.billingCycle as Cycle);
    await this.audit.record({
      tenantId,
      userId: platformUserId, // a PlatformUser id, not a hospital User id - AuditLog.userId has no FK, so this is safe and traceable
      action: 'UPDATE',
      entityType: 'SubscriptionInvoice',
      entityId: invoiceId,
      metadata: { status: 'PAID', via: 'manual', confirmedByPlatformUser: true },
    });
    return this.toInvoiceDto(updated);
  }

  /**
   * Paystack signs the raw body; idempotent via PlatformWebhookEvent (a
   * unique-constraint conflict means "already processed", not an error). The
   * tenant is not known ahead of a webhook arriving, so it is round-tripped
   * through Paystack's own `metadata` (set at checkout initiation) rather than
   * looked up - the app's DB connection cannot bypass RLS to find it any other
   * way (see rls.sql).
   */
  async handlePaystackWebhook(rawBody: Buffer, signatureHeader: string | undefined): Promise<void> {
    if (!this.paystack.verifyWebhookSignature(rawBody, signatureHeader)) {
      throw new ForbiddenException({ statusCode: 403, message: 'Invalid webhook signature', code: 'INVALID_SIGNATURE' });
    }
    const event = JSON.parse(rawBody.toString('utf8')) as { event: string; data: Record<string, unknown> };
    const eventId = String((event.data?.id as string | number | undefined) ?? event.data?.reference ?? randomUUID());

    try {
      await this.prisma.platformWebhookEvent.create({
        data: { id: eventId, provider: 'PAYSTACK', eventType: event.event ?? 'unknown', payload: event as unknown as Prisma.InputJsonValue },
      });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2002') return; // already processed - Paystack retried delivery
      throw err;
    }

    if (event.event === 'charge.success') {
      const metadata = event.data?.metadata as { tenantId?: string } | undefined;
      const tenantId = metadata?.tenantId;
      const reference = event.data?.reference as string | undefined;
      if (tenantId && reference) {
        const invoice = await this.prisma.forTenant(tenantId, (tx) =>
          tx.subscriptionInvoice.findFirst({ where: { paystackReference: reference } }),
        );
        if (invoice && invoice.status !== 'PAID') {
          await this.prisma.forTenant(tenantId, (tx) =>
            tx.subscriptionInvoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: new Date() } }),
          );
          await this.activateSubscription(tenantId, invoice.subscriptionId, invoice.billingCycle as Cycle);
          await this.audit.record({
            tenantId,
            action: 'UPDATE',
            entityType: 'SubscriptionInvoice',
            entityId: invoice.id,
            metadata: { status: 'PAID', via: 'webhook' },
          });
        }
      }
    }

    await this.prisma.platformWebhookEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
  }
}
