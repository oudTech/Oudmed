import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PayerType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { FilesService } from '../storage/files.service';
import { assertCan } from '../common/permissions';
import { nextSequence } from '../common/sequence';
import { CancelInvoiceDto, CreateInvoiceDto, ReversePaymentDto, UpdateInvoiceDto } from './dto/create-invoice.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';

export interface ChargeInput {
  tenantId: string;
  userId: string;
  visitId: string;
  patientId: string;
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal | number | string;
  category: string;
  serviceItemId?: string | null;
  orderId?: string | null;
}

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

const PAGE_SIZE = 25;
const D0 = () => new Prisma.Decimal(0);

function lineNet(unitPrice: Prisma.Decimal, quantity: number, discountPct?: number | null) {
  const gross = unitPrice.mul(quantity);
  const net = gross.mul(new Prisma.Decimal(100).sub(discountPct ?? 0)).div(100);
  return { gross, net };
}

@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private files: FilesService,
  ) {}

  private async nextNumber(tx: Prisma.TransactionClient, tenantId: string, kind: 'INV' | 'RCP') {
    // One indexed PK lookup for the configurable prefix; `nextSequence` then takes
    // the counter lock. Not worth caching - a per-tenant prefix cache would need
    // invalidation on every Settings save for a sub-millisecond read.
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { invoicePrefix: true, receiptPrefix: true },
    });
    const prefix = (kind === 'INV' ? tenant?.invoicePrefix : tenant?.receiptPrefix) || kind;
    const n = await nextSequence(tx, tenantId, kind === 'INV' ? 'invoice' : 'receipt', () =>
      kind === 'INV'
        ? tx.invoice.count({ where: { tenantId } })
        : tx.payment.count({ where: { tenantId, receiptNumber: { not: null } } }),
    );
    return `${prefix}-${String(n).padStart(6, '0')}`;
  }

  private async names(tx: Prisma.TransactionClient, ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  /** Shared active-service-item lookup used by both `catalogue` and `listServiceItems`. */
  private serviceItems(tx: Prisma.TransactionClient, opts: { category?: string; q?: string; take?: number }) {
    return tx.serviceItem.findMany({
      where: {
        isActive: true,
        ...(opts.category ? { category: { equals: opts.category, mode: 'insensitive' } } : {}),
        ...(opts.q ? { name: { contains: opts.q, mode: 'insensitive' } } : {}),
      },
      select: { id: true, name: true, category: true, unitPrice: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      ...(opts.take ? { take: opts.take } : {}),
    });
  }

  /** Sum lines and payments, then rewrite subtotal / total / status. CANCELLED is sticky. */
  async recomputeInvoice(tx: Prisma.TransactionClient, invoiceId: string) {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId },
      select: {
        status: true,
        discountPct: true,
        lines: { select: { lineTotal: true } },
        payments: { select: { amount: true, reversedAt: true } },
      },
    });
    if (!invoice) return;

    const subtotal = invoice.lines.reduce((s, l) => s.add(l.lineTotal), D0());
    const total = subtotal.mul(new Prisma.Decimal(100).sub(invoice.discountPct ?? 0)).div(100);
    const paid = invoice.payments
      .filter((p) => !p.reversedAt)
      .reduce((s, p) => s.add(p.amount), D0());

    let status: InvoiceStatus = invoice.status;
    if (status !== InvoiceStatus.CANCELLED) {
      if (paid.gte(total) && total.gt(0)) status = InvoiceStatus.PAID;
      else if (paid.gt(0)) status = InvoiceStatus.PARTIAL;
      else status = InvoiceStatus.UNPAID;
    }
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { subtotal, totalAmount: total, status },
    });
  }

  // ─────────────────────────── charge posting (unchanged callers) ───────────────────────────

  async postChargeToVisit(tx: Prisma.TransactionClient, c: ChargeInput) {
    const unitPrice = new Prisma.Decimal(c.unitPrice as any);
    const { gross, net } = lineNet(unitPrice, c.quantity, null);

    // Serialize concurrent first-charge-on-this-visit so two callers can't both
    // try to INSERT the visit's (unique) invoice and 500 on the constraint.
    // Transaction-scoped advisory lock; auto-released on commit/rollback; only
    // contends with other charges for the SAME visit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.visitId}, 0))`;

    let invoice = await tx.invoice.findFirst({ where: { visitId: c.visitId } });
    if (!invoice) {
      const visit = await tx.visit.findUnique({
        where: { id: c.visitId },
        select: { payerType: true },
      });
      invoice = await tx.invoice.create({
        data: {
          tenantId: c.tenantId,
          patientId: c.patientId,
          visitId: c.visitId,
          invoiceNumber: await this.nextNumber(tx, c.tenantId, 'INV'),
          category: c.category,
          status: InvoiceStatus.UNPAID,
          payerType: visit?.payerType ?? PayerType.CASH,
          subtotal: D0(),
          totalAmount: D0(),
          createdById: c.userId,
        },
      });
    }

    const line = await tx.invoiceLine.create({
      data: {
        tenantId: c.tenantId,
        invoiceId: invoice.id,
        serviceItemId: c.serviceItemId ?? null,
        orderId: c.orderId ?? null,
        category: c.category,
        description: c.description,
        quantity: c.quantity,
        unitPrice,
        grossAmount: gross,
        lineTotal: net,
        providedById: c.userId,
        providedAt: new Date(),
      },
    });
    await this.recomputeInvoice(tx, invoice.id);
    await this.audit.record({
      tenantId: c.tenantId, userId: c.userId, action: 'CHARGE',
      entityType: 'Invoice', entityId: invoice.id,
      metadata: { category: c.category, description: c.description, lineTotal: net.toString() },
    });
    return { invoiceId: invoice.id, lineId: line.id };
  }

  async voidInvoiceLine(tx: Prisma.TransactionClient, lineId: string) {
    const line = await tx.invoiceLine.findFirst({ where: { id: lineId } });
    if (!line) return;
    await tx.invoiceLine.delete({ where: { id: lineId } });
    await this.recomputeInvoice(tx, line.invoiceId);
  }

  async createInvoice(actor: Actor, dto: CreateInvoiceDto) {
    assertCan(actor.role, 'billing:manage');
    return this.prisma.forTenant(actor.tenantId, (tx) =>
      this.createInvoiceTx(tx, actor.tenantId, actor.userId, dto),
    );
  }

  /** Joins an existing transaction (no nested forTenant). Used by pharmacy dispense + the billing screen. */
  async createInvoiceTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    dto: CreateInvoiceDto,
  ) {
    if (!dto.lines?.length) throw new BadRequestException('An invoice needs at least one line');

    // Every foreign key on this invoice must belong to the caller's tenant.
    // RLS hides other tenants' rows from these lookups, but the Postgres FK
    // check bypasses RLS - so without this a caller could bind an invoice (or,
    // via the global unique on visitId, squat a charge slot) to another
    // tenant's patient / visit. Runs inside the caller's forTenant transaction.
    const patient = await tx.patient.findFirst({ where: { id: dto.patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('Patient not found');

    if (dto.visitId) {
      const visit = await tx.visit.findFirst({ where: { id: dto.visitId }, select: { id: true } });
      if (!visit) throw new NotFoundException('Visit not found');
    }

    const svcIds = [...new Set(dto.lines.map((l) => l.serviceItemId).filter((x): x is string => !!x))];
    if (svcIds.length) {
      const n = await tx.serviceItem.count({ where: { id: { in: svcIds } } });
      if (n !== svcIds.length) throw new BadRequestException('One or more service items are invalid');
    }
    const drugIds = [...new Set(dto.lines.map((l) => l.drugId).filter((x): x is string => !!x))];
    if (drugIds.length) {
      const n = await tx.drug.count({ where: { id: { in: drugIds } } });
      if (n !== drugIds.length) throw new BadRequestException('One or more drugs are invalid');
    }

    const lines = dto.lines.map((l) => {
      const unitPrice = new Prisma.Decimal(l.unitPrice);
      const { gross, net } = lineNet(unitPrice, l.quantity, l.discountPct);
      return {
        tenantId,
        serviceItemId: l.serviceItemId ?? null,
        drugId: l.drugId ?? null,
        category: l.category ?? dto.category ?? null,
        description: l.description,
        quantity: l.quantity,
        unitPrice,
        grossAmount: gross,
        discountPct: l.discountPct != null ? new Prisma.Decimal(l.discountPct) : null,
        lineTotal: net,
        providedById: userId,
        providedAt: new Date(),
      };
    });
    const subtotal = lines.reduce((s, l) => s.add(l.lineTotal), D0());
    const total = subtotal.mul(new Prisma.Decimal(100).sub(dto.invoiceDiscountPct ?? 0)).div(100);

    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        patientId: dto.patientId,
        visitId: dto.visitId,
        invoiceNumber: await this.nextNumber(tx, tenantId, 'INV'),
        category: dto.category ?? lines[0].category ?? 'Services',
        payerType: dto.payerType ?? PayerType.CASH,
        status: InvoiceStatus.UNPAID,
        subtotal,
        discountPct: dto.invoiceDiscountPct != null ? new Prisma.Decimal(dto.invoiceDiscountPct) : null,
        discountReason: dto.discountReason,
        totalAmount: total,
        note: dto.note,
        createdById: userId,
        lines: { create: lines },
      },
      include: { lines: true },
    });

    await this.audit.record({
      tenantId, userId, action: 'CREATE', entityType: 'Invoice', entityId: invoice.id,
      metadata: { total: total.toString(), lines: lines.length },
    });
    return invoice;
  }

  // ─────────────────────────── billing screen ───────────────────────────

  async listInvoices(
    tenantId: string,
    q: { search?: string; status?: string; category?: string; from?: string; to?: string; page?: number },
  ) {
    const page = q.page && q.page > 0 ? q.page : 1;
    return this.prisma.forTenant(tenantId, async (tx) => {
      const where: Prisma.InvoiceWhereInput = {};
      if (q.status) where.status = q.status as InvoiceStatus;
      if (q.category) where.category = { equals: q.category, mode: 'insensitive' };
      if (q.from || q.to) {
        where.createdAt = {};
        if (q.from) (where.createdAt as any).gte = new Date(q.from);
        if (q.to) (where.createdAt as any).lte = new Date(q.to);
      }
      if (q.search) {
        where.OR = [
          { invoiceNumber: { contains: q.search, mode: 'insensitive' } },
          { patient: { firstName: { contains: q.search, mode: 'insensitive' } } },
          { patient: { lastName: { contains: q.search, mode: 'insensitive' } } },
          { patient: { patientNumber: { contains: q.search, mode: 'insensitive' } } },
        ];
      }

      // Summary excludes CANCELLED and is computed with DB aggregates, not by
      // pulling every matching row into memory. Overpayment is blocked on the way
      // in, so per-invoice `total - paid` is never negative and
      // `SUM(total) - SUM(paid)` equals `SUM(max(0, total - paid))`.
      const summaryWhere: Prisma.InvoiceWhereInput = { AND: [where, { status: { not: 'CANCELLED' } }] };

      const [total, rows, invAgg, paidAgg] = await Promise.all([
        tx.invoice.count({ where }),
        tx.invoice.findMany({
          where,
          include: {
            patient: { select: { id: true, firstName: true, lastName: true, patientNumber: true } },
            payments: { select: { amount: true, reversedAt: true } },
            _count: { select: { lines: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
        tx.invoice.aggregate({ where: summaryWhere, _sum: { totalAmount: true }, _count: true }),
        tx.payment.aggregate({
          where: { reversedAt: null, invoice: summaryWhere },
          _sum: { amount: true },
        }),
      ]);

      const paidOf = (payments: { amount: Prisma.Decimal; reversedAt: Date | null }[]) =>
        payments.filter((p) => !p.reversedAt).reduce((s, p) => s.add(p.amount), D0());

      const sumAmount = invAgg._sum.totalAmount ?? D0();
      const sumPaid = paidAgg._sum.amount ?? D0();
      const sumBalance = sumAmount.sub(sumPaid);

      return {
        page,
        pageSize: PAGE_SIZE,
        total,
        summary: {
          amount: sumAmount.toString(),
          paid: sumPaid.toString(),
          balance: (sumBalance.lt(0) ? D0() : sumBalance).toString(),
          count: invAgg._count,
        },
        invoices: rows.map((inv) => {
          const paid = paidOf(inv.payments);
          const balance = inv.totalAmount.sub(paid);
          return {
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            createdAt: inv.createdAt,
            patient: inv.patient
              ? {
                  id: inv.patient.id,
                  name: `${inv.patient.firstName} ${inv.patient.lastName}`.trim(),
                  patientNumber: inv.patient.patientNumber,
                }
              : null,
            category: inv.category,
            payerType: inv.payerType,
            subtotal: inv.subtotal.toString(),
            totalAmount: inv.totalAmount.toString(),
            paidAmount: paid.toString(),
            balanceDue: (balance.lt(0) ? D0() : balance).toString(),
            status: inv.status,
            lineCount: inv._count.lines,
          };
        }),
      };
    });
  }

  async getInvoice(tenantId: string, id: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { id },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, patientNumber: true, phone: true } },
          lines: { orderBy: { providedAt: 'asc' } },
          payments: { orderBy: { paidAt: 'asc' } },
          claim: { select: { id: true, claimNumber: true, status: true } },
        },
      });
      if (!inv) throw new NotFoundException('Invoice not found');

      const nm = await this.names(tx, [
        inv.createdById,
        ...inv.lines.map((l) => l.providedById),
        ...inv.payments.map((p) => p.receivedById),
      ]);
      const paid = inv.payments.filter((p) => !p.reversedAt).reduce((s, p) => s.add(p.amount), D0());
      const balance = inv.totalAmount.sub(paid);

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        createdAt: inv.createdAt,
        status: inv.status,
        category: inv.category,
        payerType: inv.payerType,
        subtotal: inv.subtotal.toString(),
        discountPct: inv.discountPct ? inv.discountPct.toString() : null,
        discountReason: inv.discountReason,
        totalAmount: inv.totalAmount.toString(),
        paidAmount: paid.toString(),
        balanceDue: (balance.lt(0) ? D0() : balance).toString(),
        note: inv.note,
        createdByName: inv.createdById ? nm.get(inv.createdById) ?? null : null,
        cancelledAt: inv.cancelledAt,
        voidReason: inv.voidReason,
        visitId: inv.visitId,
        claim: inv.claim
          ? { id: inv.claim.id, claimNumber: inv.claim.claimNumber, status: inv.claim.status }
          : null,
        patient: inv.patient
          ? {
              id: inv.patient.id,
              name: `${inv.patient.firstName} ${inv.patient.lastName}`.trim(),
              patientNumber: inv.patient.patientNumber,
              phone: inv.patient.phone,
            }
          : null,
        lines: inv.lines.map((l) => ({
          id: l.id,
          category: l.category,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice.toString(),
          grossAmount: l.grossAmount.toString(),
          discountPct: l.discountPct ? l.discountPct.toString() : null,
          lineTotal: l.lineTotal.toString(),
          drugId: l.drugId,
          providedByName: l.providedById ? nm.get(l.providedById) ?? null : null,
          providedAt: l.providedAt,
        })),
        payments: inv.payments.map((p) => ({
          id: p.id,
          receiptNumber: p.receiptNumber,
          amount: p.amount.toString(),
          method: p.method,
          payerType: p.payerType,
          payerName: p.payerName,
          reference: p.reference,
          note: p.note,
          receivedByName: p.receivedById ? nm.get(p.receivedById) ?? null : null,
          paidAt: p.paidAt,
          reversedAt: p.reversedAt,
          reversalReason: p.reversalReason,
        })),
      };
    });
  }

  async catalogue(tenantId: string, type: string, q?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      if (type === 'Medication') {
        const drugs = await tx.drug.findMany({
          where: {
            isActive: true,
            ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { genericName: { contains: q, mode: 'insensitive' } }] } : {}),
          },
          orderBy: { name: 'asc' },
          take: 15,
          select: { id: true, name: true, sellPrice: true, quantityOnHand: true, packaging: true },
        });
        return drugs.map((d) => ({
          id: d.id,
          name: d.name,
          unitPrice: d.sellPrice.toString(),
          category: 'Medication',
          stock: d.quantityOnHand,
          packaging: d.packaging,
        }));
      }
      if (type === 'Others') return [];
      const category = type === 'Laboratory' ? 'Laboratory' : undefined;
      const items = await this.serviceItems(tx, { category, q, take: 20 });
      return items
        .filter((i) => type !== 'Services' || (i.category ?? '').toLowerCase() !== 'laboratory')
        .map((i) => ({
          id: i.id,
          name: i.name,
          unitPrice: i.unitPrice.toString(),
          category: i.category ?? 'Services',
          stock: null as number | null,
          packaging: null as string | null,
        }));
    });
  }

  // ─────────────────────────── payments ───────────────────────────

  async addPayment(actor: Actor, invoiceId: string, dto: CreatePaymentDto, opts: { patientId?: string } = {}) {
    assertCan(actor.role, 'invoice:pay');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      // Serialize every payment against THIS invoice. The balance check below
      // reads paid-so-far and then inserts a payment; without this lock two
      // concurrent payments both read the same paid-so-far, both pass the
      // overpayment guard, and both insert (total paid > invoice total).
      // Transaction-scoped advisory lock, auto-released on commit/rollback,
      // same pattern as postChargeToVisit; only contends with other payments
      // for this invoice. Independent of the idempotency-key lock below.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${invoiceId}, 0))`;

      // Idempotency: a retried "Record payment" (double-click, network retry)
      // carrying the same client-generated key must not create a second payment.
      // The advisory lock serializes a true concurrent double-submit so the
      // second request sees the first's row; `@@unique([tenantId, idempotencyKey])`
      // is the last-resort backstop.
      if (dto.idempotencyKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.idempotencyKey}, 0))`;
        const prior = await tx.payment.findFirst({
          where: { tenantId: actor.tenantId, idempotencyKey: dto.idempotencyKey },
        });
        if (prior) {
          const inv = await tx.invoice.findFirst({
            where: { id: prior.invoiceId },
            select: { status: true, totalAmount: true, payments: { select: { amount: true, reversedAt: true } } },
          });
          const paid = (inv?.payments ?? []).filter((p) => !p.reversedAt).reduce((s, p) => s.add(p.amount), D0());
          const bal = (inv?.totalAmount ?? D0()).sub(paid);
          return {
            paymentId: prior.id,
            receiptNumber: prior.receiptNumber,
            status: inv?.status ?? 'UNPAID',
            balanceDue: (bal.lt(0) ? D0() : bal).toString(),
            idempotentReplay: true,
          };
        }
      }

      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, ...(opts.patientId ? { patientId: opts.patientId } : {}) },
        include: { payments: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status === 'CANCELLED') {
        throw new BadRequestException('This invoice has been cancelled');
      }

      const paidSoFar = invoice.payments.filter((p) => !p.reversedAt).reduce((s, p) => s.add(p.amount), D0());
      const balance = invoice.totalAmount.sub(paidSoFar);
      if (new Prisma.Decimal(dto.amount).gt(balance)) {
        throw new BadRequestException({
          message: `Payment exceeds the balance due (${balance.toString()})`,
          code: 'OVERPAYMENT',
        });
      }

      const payment = await tx.payment.create({
        data: {
          tenantId: actor.tenantId,
          invoiceId,
          receiptNumber: await this.nextNumber(tx, actor.tenantId, 'RCP'),
          amount: new Prisma.Decimal(dto.amount),
          method: dto.method,
          payerType: dto.payerType ?? invoice.payerType ?? PayerType.CASH,
          payerName: dto.payerName,
          reference: dto.reference,
          note: dto.note,
          idempotencyKey: dto.idempotencyKey ?? null,
          receivedById: actor.userId,
        },
      });
      await this.recomputeInvoice(tx, invoiceId);
      const updated = await tx.invoice.findFirst({ where: { id: invoiceId } });

      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'PAYMENT',
        entityType: 'Invoice', entityId: invoiceId,
        metadata: { amount: dto.amount, method: dto.method, receipt: payment.receiptNumber, status: updated?.status },
      });
      return {
        paymentId: payment.id,
        receiptNumber: payment.receiptNumber,
        status: updated?.status ?? invoice.status,
        balanceDue: updated ? updated.totalAmount.sub(paidSoFar.add(dto.amount)).toString() : '0',
      };
    });
  }

  async reversePayment(actor: Actor, paymentId: string, dto: ReversePaymentDto) {
    assertCan(actor.role, 'billing:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const payment = await tx.payment.findFirst({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.reversedAt) throw new BadRequestException('This payment is already reversed');

      await tx.payment.update({
        where: { id: paymentId },
        data: { reversedAt: new Date(), reversedById: actor.userId, reversalReason: dto.reason },
      });
      await this.recomputeInvoice(tx, payment.invoiceId);
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'PAYMENT_REVERSED',
        entityType: 'Invoice', entityId: payment.invoiceId,
        metadata: { paymentId, amount: payment.amount.toString(), reason: dto.reason },
      });
      return { ok: true };
    });
  }

  async cancelInvoice(actor: Actor, id: string, dto: CancelInvoiceDto) {
    assertCan(actor.role, 'billing:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id }, include: { payments: true } });
      if (!inv) throw new NotFoundException('Invoice not found');
      if (inv.status === 'CANCELLED') return { ok: true };
      if (inv.payments.some((p) => !p.reversedAt)) {
        throw new BadRequestException({
          message: 'Reverse the payments on this invoice before cancelling it',
          code: 'HAS_PAYMENTS',
        });
      }
      await tx.invoice.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actor.userId, voidReason: dto.reason },
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'CANCEL',
        entityType: 'Invoice', entityId: id, metadata: { reason: dto.reason },
      });
      return { ok: true };
    });
  }

  /**
   * Correct an invoice after creation: invoice-level discount, reason, note,
   * category. Blocked once the invoice is CANCELLED or carries a live payment
   * (reverse the payments first). Individual line edits are delete + re-add
   * (`removeInvoiceLine` / raise a fresh invoice) - deliberately not a full
   * line editor.
   */
  async updateInvoice(actor: Actor, id: string, dto: UpdateInvoiceDto) {
    assertCan(actor.role, 'billing:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id }, include: { payments: true } });
      if (!inv) throw new NotFoundException('Invoice not found');
      if (inv.status === 'CANCELLED') throw new BadRequestException('This invoice has been cancelled');
      if (inv.payments.some((p) => !p.reversedAt)) {
        throw new BadRequestException({ message: 'Reverse the payments on this invoice before editing it', code: 'HAS_PAYMENTS' });
      }
      const data: Prisma.InvoiceUpdateInput = {};
      if (dto.invoiceDiscountPct !== undefined)
        data.discountPct = new Prisma.Decimal(dto.invoiceDiscountPct);
      if (dto.discountReason !== undefined) data.discountReason = dto.discountReason || null;
      if (dto.note !== undefined) data.note = dto.note || null;
      if (dto.category !== undefined) data.category = dto.category;

      await tx.invoice.update({ where: { id }, data });
      await this.recomputeInvoice(tx, id);
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE',
        entityType: 'Invoice', entityId: id, metadata: { fields: Object.keys(data) },
      });
      return { ok: true };
    });
  }

  /** Remove a single line from an invoice (billing-desk correction). Same guards as updateInvoice. */
  async removeInvoiceLine(actor: Actor, id: string, lineId: string) {
    assertCan(actor.role, 'billing:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { id },
        include: { payments: true, lines: { select: { id: true } } },
      });
      if (!inv) throw new NotFoundException('Invoice not found');
      if (inv.status === 'CANCELLED') throw new BadRequestException('This invoice has been cancelled');
      if (inv.payments.some((p) => !p.reversedAt)) {
        throw new BadRequestException({ message: 'Reverse the payments on this invoice before editing it', code: 'HAS_PAYMENTS' });
      }
      if (!inv.lines.some((l) => l.id === lineId)) throw new NotFoundException('Line not found on this invoice');
      if (inv.lines.length <= 1) {
        throw new BadRequestException('An invoice must keep at least one line - cancel it instead');
      }
      await this.voidInvoiceLine(tx, lineId); // deletes the line + recomputes
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'VOID_LINE',
        entityType: 'Invoice', entityId: id, metadata: { lineId },
      });
      return { ok: true };
    });
  }

  async receipt(tenantId: string, paymentId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id: paymentId },
        include: {
          invoice: {
            include: {
              patient: { select: { firstName: true, lastName: true, patientNumber: true } },
              lines: true,
              payments: { select: { amount: true, reversedAt: true, paidAt: true } },
            },
          },
        },
      });
      if (!payment || !payment.receiptNumber) throw new NotFoundException('Receipt not found');
      const inv = payment.invoice;

      const nm = await this.names(tx, [payment.receivedById]);
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { name: true, logoUrl: true, address: true, phone: true, rcNumber: true, taxId: true, documentFooter: true },
      });
      const hospitalLogo = await this.files.presignRef(tenantId, tenant?.logoUrl, tx as any, 600);

      const paidUpTo = inv.payments
        .filter((p) => !p.reversedAt && p.paidAt <= payment.paidAt)
        .reduce((s, p) => s.add(p.amount), D0());
      const balanceAfter = inv.totalAmount.sub(paidUpTo);

      return {
        hospitalName: tenant?.name ?? 'Hospital',
        hospitalLogo,
        hospitalAddress: tenant?.address ?? null,
        hospitalPhone: tenant?.phone ?? null,
        hospitalRcNumber: tenant?.rcNumber ?? null,
        hospitalTaxId: tenant?.taxId ?? null,
        documentFooter: tenant?.documentFooter ?? null,
        receiptNumber: payment.receiptNumber,
        paidAt: payment.paidAt,
        amount: payment.amount.toString(),
        method: payment.method,
        payerType: payment.payerType,
        payerName: payment.payerName,
        reference: payment.reference,
        cashierName: payment.receivedById ? nm.get(payment.receivedById) ?? null : null,
        invoiceNumber: inv.invoiceNumber,
        invoiceTotal: inv.totalAmount.toString(),
        balanceAfter: (balanceAfter.lt(0) ? D0() : balanceAfter).toString(),
        patient: inv.patient
          ? { name: `${inv.patient.firstName} ${inv.patient.lastName}`.trim(), patientNumber: inv.patient.patientNumber }
          : null,
        lines: inv.lines.map((l) => ({ description: l.description, quantity: l.quantity, lineTotal: l.lineTotal.toString() })),
      };
    });
  }

  // ─────────────────────────── service items ───────────────────────────

  async listServiceItems(tenantId: string, category?: string, q?: string) {
    return this.prisma.forTenant(tenantId, (tx) => this.serviceItems(tx, { category, q }));
  }

  async createServiceItem(actor: Actor, dto: { name: string; category?: string; unitPrice: number }) {
    // A billable-service catalogue entry is billing configuration, not ward
    // configuration. The controller route also carries @Roles(HOSPITAL_ADMIN,
    // SUPER_ADMIN), which stays the effective ceiling.
    assertCan(actor.role, 'billing:manage');
    return this.prisma.forTenant(actor.tenantId, (tx) =>
      tx.serviceItem.create({
        data: {
          tenantId: actor.tenantId,
          name: dto.name,
          category: dto.category,
          unitPrice: new Prisma.Decimal(dto.unitPrice),
        },
        select: { id: true, name: true, category: true, unitPrice: true },
      }),
    );
  }

}
