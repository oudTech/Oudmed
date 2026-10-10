import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { assertCan, can } from '../common/permissions';
import { lagosCalendarDate } from '../common/lagos-time';
import { resolveInsuranceProvider } from '../common/insurance-provider-resolver';
import { DispenseDto, PrepareDto, CancelPreparationDto } from './dto/pharmacy.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

const D0 = () => new Prisma.Decimal(0);

type PrescriptionRow = { id: string; visitId: string | null; admissionId: string | null; patientId: string; notes: string | null; dispensedById: string | null; dispensedAt: Date | null };
type PrescriptionItemRow = { id: string; drugId: string | null; drugName: string; strengthConc: string | null; dispensedQty: number | null; preparedQty: number; preparedUnitPrice: Prisma.Decimal | null; preparedInvoiceLineId: string | null };

/**
 * A prescription's dispenseStatus is derived, never set directly, from the
 * combined dispensedQty/preparedQty of every item on it (F2) - computed the
 * same way PARTIAL/DISPENSED already were before F2 existed, just now aware
 * of the prepared-but-unreleased state too. AWAITING_PAYMENT takes priority
 * over PARTIAL/DISPENSED whenever at least one item has something prepared
 * and no item is still fully untouched, exactly as the design calls for.
 */
function computeDispenseStatus(items: { dispensedQty: number | null; preparedQty: number | null }[]) {
  const hasPrepared = items.some((it) => (it.preparedQty ?? 0) > 0);
  const hasDispensed = items.some((it) => (it.dispensedQty ?? 0) > 0);
  const allTouched = items.every((it) => (it.dispensedQty ?? 0) > 0 || (it.preparedQty ?? 0) > 0);
  if (hasPrepared && allTouched) return 'AWAITING_PAYMENT' as const;
  if (allTouched && hasDispensed) return 'DISPENSED' as const;
  if (hasDispensed || hasPrepared) return 'PARTIAL' as const;
  return 'PENDING' as const;
}

@Injectable()
export class PharmacyService {
  private readonly log = new Logger(PharmacyService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private billing: BillingService,
  ) {}

  async queue(tenantId: string, status?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const where: Prisma.PrescriptionWhereInput = {
        dispenseStatus: status ? (status as any) : { in: ['PENDING', 'PARTIAL', 'AWAITING_PAYMENT'] },
      };
      const rows = await tx.prescription.findMany({
        where,
        include: {
          items: { include: { drug: { select: { sellPrice: true, quantityOnHand: true } } } },
          patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true, allergies: true } },
        },
        orderBy: { prescribedAt: 'desc' },
        take: 100,
      });
      const ids = [...new Set(rows.map((r) => r.prescribedById).filter(Boolean) as string[])];
      const users = ids.length
        ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
        : [];
      const nm = new Map(users.map((u) => [u.id, u.fullName]));

      // F2: "paid, ready to dispense" vs "awaiting payment" is computed live
      // by joining every prepared line to its invoice here, never cached on
      // the item itself - a payment reversal is reflected immediately on
      // the next read, with no separate reconciliation step. The gate is
      // the PATIENT's own payable share (co-pay plus any uncovered charges
      // on the same invoice), not the whole invoice - see
      // patientPayableAmount()/release() for why.
      const lineIds = [
        ...new Set(rows.flatMap((r) => r.items.map((it) => it.preparedInvoiceLineId).filter((x): x is string => !!x))),
      ];
      const lines = lineIds.length
        ? await tx.invoiceLine.findMany({
            where: { id: { in: lineIds } },
            select: {
              id: true,
              invoice: {
                select: {
                  id: true, totalAmount: true, visitId: true, patientId: true,
                  payments: { select: { amount: true, reversedAt: true } },
                },
              },
            },
          })
        : [];
      const payableByInvoiceId = new Map<string, Prisma.Decimal>();
      for (const invoiceId of new Set(lines.map((l) => l.invoice.id))) {
        const inv = lines.find((l) => l.invoice.id === invoiceId)!.invoice;
        payableByInvoiceId.set(invoiceId, await this.patientPayableAmount(tx, inv, tenantId));
      }
      const statusByLineId = new Map(
        lines.map((l) => {
          const totalPaid = l.invoice.payments.filter((p) => !p.reversedAt).reduce((s, p) => s.add(p.amount), D0());
          const outstanding = payableByInvoiceId.get(l.invoice.id)!.sub(totalPaid);
          return [l.id, { paid: outstanding.lte(0), awaitingAmount: outstanding.gt(0) ? outstanding.toString() : null }];
        }),
      );

      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        dispenseStatus: r.dispenseStatus,
        notes: r.notes,
        prescribedAt: r.prescribedAt,
        prescribedByName: r.prescribedById ? nm.get(r.prescribedById) ?? null : null,
        visitId: r.visitId,
        patient: r.patient,
        items: r.items.map((it) => ({
          id: it.id,
          drugId: it.drugId,
          drugName: it.drugName,
          dosageForm: it.dosageForm,
          strengthConc: it.strengthConc,
          amountPerUse: it.amountPerUse,
          frequency: it.frequency,
          durationType: it.durationType,
          durationNumber: it.durationNumber,
          dispensedQty: it.dispensedQty,
          dispenseUnitPrice: it.dispenseUnitPrice ? it.dispenseUnitPrice.toString() : null,
          sellPrice: it.drug?.sellPrice ? it.drug.sellPrice.toString() : null,
          quantityOnHand: it.drug?.quantityOnHand ?? null,
          preparedQty: it.preparedQty,
          preparedUnitPrice: it.preparedUnitPrice ? it.preparedUnitPrice.toString() : null,
          // true = the patient's payable share is covered, ready to release;
          // false = still awaiting (some of) that share; null = nothing
          // prepared, or a zero-price preparation with no invoice line to
          // check at all (releases unconditionally).
          preparedInvoicePaid:
            it.preparedQty > 0
              ? (it.preparedInvoiceLineId ? statusByLineId.get(it.preparedInvoiceLineId)?.paid ?? false : true)
              : null,
          // The patient's own outstanding balance still owed before this
          // item can release - null once paid or not applicable. Never the
          // HMO's share.
          preparedAwaitingAmount:
            it.preparedQty > 0 && it.preparedInvoiceLineId
              ? statusByLineId.get(it.preparedInvoiceLineId)?.awaitingAmount ?? null
              : null,
        })),
      }));
    });
  }

  async dispense(actor: Actor, id: string, dto: DispenseDto) {
    assertCan(actor.role, 'prescription:dispense');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      // Serialize concurrent dispense attempts for THIS prescription. The second
      // attempt then reads the first's committed dispensedQty, so the delta
      // below is 0 and it neither draws stock nor posts a charge again.
      // Transaction-scoped advisory lock, same pattern as postChargeToVisit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;

      const rx = await tx.prescription.findFirst({ where: { id }, include: { items: true } });
      if (!rx) throw new NotFoundException('Prescription not found');
      if (rx.dispenseStatus === 'DISPENSED' || rx.dispenseStatus === 'CANCELLED') {
        throw new BadRequestException('This prescription is already closed');
      }

      // F2: while the gate is on, this one-step dispense is only reachable as
      // a flagged, audited emergency override - everyone else goes through
      // prepare()/release() instead. Checked here, not in the controller, so
      // it is enforced regardless of caller.
      const tenant = await tx.tenant.findUnique({
        where: { id: actor.tenantId },
        select: { requirePaymentBeforeDispense: true },
      });
      if (tenant?.requirePaymentBeforeDispense && !dto.emergencyOverride) {
        throw new BadRequestException({
          code: 'PAYMENT_GATE_ACTIVE',
          message: 'This hospital requires payment before dispensing. Use Prepare instead, or dispense now as a flagged emergency override.',
        });
      }
      if (dto.emergencyOverride) {
        if (!dto.emergencyReason?.trim()) {
          throw new BadRequestException('A reason is required to dispense as an emergency override');
        }
        assertCan(actor.role, 'pharmacy:dispense-emergency-override');
      }

      const byId = new Map(rx.items.map((it) => [it.id, it]));
      const canOverridePrice = can(actor.role, 'billing:manage');

      // Each line's `quantity` is the cumulative quantity dispensed for that item
      // (the dispensing form pre-fills it with the item's current dispensedQty).
      // Only the increase over what is already recorded draws stock and posts a
      // charge - so replaying a completed dispense is a no-op, and a top-up
      // moves only the delta.
      const plan: { line: (typeof dto.items)[number]; it: (typeof rx.items)[number]; delta: number; unitPrice: number }[] = [];
      for (const line of dto.items) {
        const it = byId.get(line.itemId);
        if (!it) throw new BadRequestException('Unknown prescription item');
        const delta = line.quantity - (it.dispensedQty ?? 0);
        plan.push({ line, it, delta, unitPrice: await this.resolveDispensePrice(tx, actor, rx.visitId, it, line, delta, canOverridePrice) });
      }

      for (const p of plan) {
        if (p.delta <= 0) continue;
        await tx.prescriptionItem.update({
          where: { id: p.line.itemId },
          data: {
            dispensedQty: p.line.quantity,
            dispenseUnitPrice: new Prisma.Decimal(p.unitPrice),
          },
        });
      }

      // Serialize stock allocation per drug so two concurrent dispenses of the
      // same drug cannot both pass the availability check and drive a batch
      // negative. Locks are acquired in sorted order so concurrent dispenses
      // that touch the same set of drugs cannot deadlock.
      const drugIds = [
        ...new Set(plan.filter((p) => p.delta > 0 && p.it.drugId).map((p) => p.it.drugId as string)),
      ].sort();
      for (const drugId of drugIds) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${drugId}, 0))`;
      }

      // FEFO stock draw-down for the delta of items linked to the catalogue
      for (const p of plan) {
        if (!p.it.drugId || p.delta <= 0) continue;
        await this.drawStockFefo(tx, {
          tenantId: actor.tenantId,
          userId: actor.userId,
          drugId: p.it.drugId,
          quantity: p.delta,
          unitPrice: p.unitPrice,
          prescriptionId: rx.id,
          visitId: rx.visitId,
        });
      }

      // charge the delta only
      const billable = plan.filter((p) => p.delta > 0 && p.unitPrice > 0);
      if (billable.length) {
        // Precedence (F1, corrected): the charge follows where the
        // prescription was actually written, not the patient's live status.
        // admissionId or visitId already recorded on the prescription is the
        // source of truth and wins outright, even if the patient is now
        // admitted (an outpatient script stays on its own visit invoice) or
        // was admitted when written but has since been discharged. Only a
        // prescription with no recorded context at all (written from the
        // general patient chart) falls back to the patient's open admission,
        // so it lands on a running bill instead of a stray standalone invoice.
        const admissionId = rx.admissionId
          ?? (rx.visitId ? null : await this.billing.resolveBillingTarget(tx, rx.patientId));
        if (admissionId) {
          for (const p of billable) {
            await this.billing.postCharge(tx, {
              tenantId: actor.tenantId,
              userId: actor.userId,
              admissionId,
              patientId: rx.patientId,
              description: `${p.it.drugName}${p.it.strengthConc ? ` ${p.it.strengthConc}` : ''} x${p.delta}`,
              quantity: p.delta,
              unitPrice: p.unitPrice,
              category: 'Pharmacy',
            });
          }
        } else if (rx.visitId) {
          for (const p of billable) {
            await this.billing.postChargeToVisit(tx, {
              tenantId: actor.tenantId,
              userId: actor.userId,
              visitId: rx.visitId,
              patientId: rx.patientId,
              description: `${p.it.drugName}${p.it.strengthConc ? ` ${p.it.strengthConc}` : ''} x${p.delta}`,
              quantity: p.delta,
              unitPrice: p.unitPrice,
              category: 'Pharmacy',
            });
          }
        } else {
          await this.billing.createInvoiceTx(tx, actor.tenantId, actor.userId, {
            patientId: rx.patientId,
            category: 'Pharmacy',
            lines: billable.map((p) => ({
              category: 'Pharmacy',
              description: `${p.it.drugName}${p.it.strengthConc ? ` ${p.it.strengthConc}` : ''} x${p.delta}`,
              quantity: p.delta,
              unitPrice: p.unitPrice,
            })),
          } as any);
        }
      }

      const freshItems = await tx.prescriptionItem.findMany({ where: { prescriptionId: id } });
      const status = computeDispenseStatus(freshItems);

      const updated = await tx.prescription.update({
        where: { id },
        data: {
          dispenseStatus: status,
          dispensedById: actor.userId,
          dispensedAt: new Date(),
          notes: dto.note ? appendNote(rx.notes, dto.note) : rx.notes,
        },
        include: { items: true },
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'DISPENSE',
        entityType: 'Prescription', entityId: id,
        metadata: { status: updated.dispenseStatus },
      });
      if (dto.emergencyOverride) {
        await this.audit.record({
          tenantId: actor.tenantId, userId: actor.userId, action: 'EMERGENCY_DISPENSE_OVERRIDE',
          entityType: 'Prescription', entityId: id,
          metadata: { reason: dto.emergencyReason, items: plan.filter((p) => p.delta > 0).map((p) => ({ itemId: p.it.id, drugName: p.it.drugName, quantity: p.delta, unitPrice: p.unitPrice })) },
        });
      }
      return updated;
    });
  }

  /**
   * F2: the gated entry point used whenever `requirePaymentBeforeDispense` is
   * on. No stock moves here - only a charge is posted, recorded against the
   * item as `preparedQty` rather than `dispensedQty`, until `release()`
   * confirms the carrying invoice is actually paid. The three exemptions
   * (inpatient, fully HMO-covered at 0% co-pay, zero-price) still dispense
   * immediately within this same call, exactly as they would with the
   * setting off - they are not a separate code path, so there is nothing to
   * "skip" to.
   *
   * Co-pay (any coPayPct > 0): the WHOLE item is held - full quantity, full
   * charge, one invoice line - until the invoice is paid, then the full
   * quantity releases at once. No splitting the quantity or the charge
   * between a covered share and a co-pay share (that was the design before
   * 2026-10-08; changed because a patient-facing "why did only some of my
   * tablets come out" partial release was worse than just holding the whole
   * item). The invoice line still carries the item's real full price, so
   * ClaimsService.generate() computes the correct HMO/patient split later
   * from the pooled invoice total, same as any other billable line.
   */
  async prepare(actor: Actor, id: string, dto: PrepareDto) {
    assertCan(actor.role, 'prescription:dispense');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;

      const rx = await tx.prescription.findFirst({ where: { id }, include: { items: true } });
      if (!rx) throw new NotFoundException('Prescription not found');
      if (rx.dispenseStatus === 'DISPENSED' || rx.dispenseStatus === 'CANCELLED') {
        throw new BadRequestException('This prescription is already closed');
      }

      const byId = new Map(rx.items.map((it) => [it.id, it]));
      const canOverridePrice = can(actor.role, 'billing:manage');

      // Same admission precedence as dispense(): a recorded admissionId/visitId
      // on the prescription wins outright; only a chart-only script falls back
      // to the patient's currently-open admission.
      const admissionId = rx.admissionId
        ?? (rx.visitId ? null : await this.billing.resolveBillingTarget(tx, rx.patientId));
      const coPayPct = admissionId ? 0 : await this.resolveCoPay(tx, rx, actor.tenantId);

      const drugIds = [...new Set(rx.items.filter((it) => it.drugId).map((it) => it.drugId as string))].sort();
      for (const drugId of drugIds) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${drugId}, 0))`;
      }

      for (const line of dto.items) {
        const it = byId.get(line.itemId);
        if (!it) throw new BadRequestException('Unknown prescription item');
        const alreadyActioned = (it.dispensedQty ?? 0) + (it.preparedQty ?? 0);
        const delta = line.quantity - alreadyActioned;
        if (delta <= 0) continue;

        const unitPrice = await this.resolveDispensePrice(tx, actor, rx.visitId, it, line, delta, canOverridePrice);

        if (coPayPct <= 0) {
          // Fully HMO-covered (or exempt, e.g. an admission) - the whole
          // delta dispenses now, no gate at all.
          if (it.drugId) {
            await this.drawStockFefo(tx, {
              tenantId: actor.tenantId, userId: actor.userId, drugId: it.drugId,
              quantity: delta, unitPrice, prescriptionId: rx.id, visitId: rx.visitId,
            });
          }
          if (unitPrice > 0) {
            await this.chargeDelta(tx, actor, rx, it, delta, unitPrice, admissionId);
          }
          await tx.prescriptionItem.update({
            where: { id: it.id },
            data: { dispensedQty: (it.dispensedQty ?? 0) + delta, dispenseUnitPrice: new Prisma.Decimal(unitPrice) },
          });
        } else {
          // Any co-pay at all (even a small one) holds the WHOLE item - full
          // quantity, full charge, one invoice line - until the invoice is
          // paid. No splitting the quantity or the charge between a covered
          // share and a co-pay share; the full amount still lets
          // ClaimsService.generate() compute the real HMO/patient split
          // later from the pooled invoice total, exactly as it does for any
          // other billable line on an HMO visit.
          let preparedInvoiceLineId: string | null = null;
          if (unitPrice > 0) {
            const posted = await this.chargeDelta(tx, actor, rx, it, delta, unitPrice, admissionId);
            preparedInvoiceLineId = posted.lineId;
          }
          await tx.prescriptionItem.update({
            where: { id: it.id },
            data: {
              preparedQty: (it.preparedQty ?? 0) + delta,
              preparedUnitPrice: new Prisma.Decimal(unitPrice),
              preparedInvoiceLineId,
              preparedAt: new Date(),
              preparedById: actor.userId,
            },
          });
          await this.audit.record({
            tenantId: actor.tenantId, userId: actor.userId, action: 'PREPARE_DISPENSE',
            entityType: 'PrescriptionItem', entityId: it.id,
            metadata: { drugName: it.drugName, quantity: delta, unitPrice, invoiceLineId: preparedInvoiceLineId },
          });
        }
      }

      const freshItems = await tx.prescriptionItem.findMany({ where: { prescriptionId: id } });
      const status = computeDispenseStatus(freshItems);
      return tx.prescription.update({
        where: { id },
        data: {
          dispenseStatus: status,
          notes: dto.note ? appendNote(rx.notes, dto.note) : rx.notes,
        },
        include: { items: true },
      });
    });
  }

  /** Given the visit's (or, with no visit, the patient's own) linked
   * InsuranceProvider, the patient's co-pay percentage - same resolver
   * `ClaimsService.generate()` uses. A patient with no linked provider at
   * all is a cash patient: 100, the whole charge is gated, not exempt. */
  private async resolveCoPay(
    tx: Prisma.TransactionClient,
    rx: { visitId: string | null; patientId: string },
    tenantId: string,
  ): Promise<number> {
    if (rx.visitId) {
      const visit = await tx.visit.findFirst({
        where: { id: rx.visitId },
        include: { patient: true },
      });
      if (visit) {
        const resolved = await resolveInsuranceProvider(tx, {
          tenantId,
          ownProviderId: visit.insuranceProviderId,
          patientProviderId: visit.patient.insuranceProviderId,
          nameGuess: visit.hmoName ?? visit.patient.hmoName ?? visit.patient.insuranceProvider,
          context: `PharmacyService.resolveCoPay visit ${rx.visitId}`,
        });
        return resolved ? resolved.coPayPct : 100;
      }
    }
    const patient = await tx.patient.findFirst({ where: { id: rx.patientId } });
    if (!patient) return 100;
    const resolved = await resolveInsuranceProvider(tx, {
      tenantId,
      patientProviderId: patient.insuranceProviderId,
      nameGuess: patient.insuranceProvider,
      context: `PharmacyService.resolveCoPay patient ${rx.patientId}`,
    });
    return resolved ? resolved.coPayPct : 100;
  }

  /** The portion of an invoice's total the PATIENT is responsible for -
   * co-pay plus any uncovered charges on the same invoice - not the HMO's
   * share, which is only settled weeks later at remittance. Reuses
   * resolveCoPay() (the same resolution the gate itself and
   * ClaimsService.generate() use), so "what the patient owes" can never
   * drift from "what the gate checks". A cash patient resolves to 100%
   * (the whole invoice), matching the pre-2026-10-09 behaviour exactly. */
  private async patientPayableAmount(
    tx: Prisma.TransactionClient,
    invoice: { totalAmount: Prisma.Decimal; visitId: string | null; patientId: string },
    tenantId: string,
  ): Promise<Prisma.Decimal> {
    const coPayPct = await this.resolveCoPay(tx, { visitId: invoice.visitId, patientId: invoice.patientId }, tenantId);
    return invoice.totalAmount.mul(coPayPct).div(100);
  }

  /** Posts one item's charge to wherever this prescription's charges go -
   * same admission/visit/chart-only routing `dispense()` uses. */
  private async chargeDelta(
    tx: Prisma.TransactionClient,
    actor: Actor,
    rx: { visitId: string | null; patientId: string },
    it: { drugName: string; strengthConc: string | null },
    qty: number,
    unitPrice: number,
    admissionId: string | null,
  ): Promise<{ invoiceId: string; lineId: string }> {
    const description = `${it.drugName}${it.strengthConc ? ` ${it.strengthConc}` : ''} x${qty}`;
    if (admissionId) {
      return this.billing.postCharge(tx, {
        tenantId: actor.tenantId, userId: actor.userId, admissionId, patientId: rx.patientId,
        description, quantity: qty, unitPrice, category: 'Pharmacy',
      });
    }
    if (rx.visitId) {
      return this.billing.postChargeToVisit(tx, {
        tenantId: actor.tenantId, userId: actor.userId, visitId: rx.visitId, patientId: rx.patientId,
        description, quantity: qty, unitPrice, category: 'Pharmacy',
      });
    }
    const invoice = await this.billing.createInvoiceTx(tx, actor.tenantId, actor.userId, {
      patientId: rx.patientId,
      category: 'Pharmacy',
      lines: [{ category: 'Pharmacy', description, quantity: qty, unitPrice }],
    } as any);
    return { invoiceId: invoice.id, lineId: invoice.lines[0].id };
  }

  /**
   * F2: for every item with `preparedQty > 0`, re-fetches its specific
   * `preparedInvoiceLineId`'s parent invoice (never a cached "paid" flag)
   * and releases it - draws stock, bumps `dispensedQty`, clears the
   * prepared state - once the PATIENT's own payable share of that invoice
   * (co-pay plus any uncovered charges, `patientPayableAmount()` - not the
   * HMO's share, which only settles weeks later at remittance) is covered.
   * Changed 2026-10-09: this used to require the whole invoice `PAID`,
   * which for an HMO patient meant waiting on the insurer's remittance
   * before the patient could ever collect drugs they had already paid
   * their own share for. A cash patient (coPayPct resolves to 100%) still
   * needs the whole invoice paid, unchanged. All-or-nothing per item: a
   * patient balance still outstanding leaves that item untouched and
   * reported back, never a partial stock draw against a partially-settled
   * bill.
   */
  async release(actor: Actor, id: string) {
    assertCan(actor.role, 'prescription:dispense');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
      const rx = await tx.prescription.findFirst({ where: { id }, include: { items: true } });
      if (!rx) throw new NotFoundException('Prescription not found');

      const preparedItems = rx.items.filter((it) => (it.preparedQty ?? 0) > 0);
      const released: string[] = [];
      const stillAwaiting: { itemId: string; drugName: string; reason: string }[] = [];

      const drugIds = [...new Set(preparedItems.filter((it) => it.drugId).map((it) => it.drugId as string))].sort();
      for (const drugId of drugIds) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${drugId}, 0))`;
      }

      for (const it of preparedItems) {
        let paid = true;
        let balance = D0();
        if (it.preparedInvoiceLineId) {
          const line = await tx.invoiceLine.findFirst({ where: { id: it.preparedInvoiceLineId }, select: { invoiceId: true } });
          const invoice = line
            ? await tx.invoice.findFirst({
                where: { id: line.invoiceId },
                select: { totalAmount: true, visitId: true, patientId: true, payments: { select: { amount: true, reversedAt: true } } },
              })
            : null;
          if (invoice) {
            const totalPaid = invoice.payments.filter((p) => !p.reversedAt).reduce((s, p) => s.add(p.amount), D0());
            const patientPayable = await this.patientPayableAmount(tx, invoice, actor.tenantId);
            const outstanding = patientPayable.sub(totalPaid);
            paid = outstanding.lte(0);
            if (!paid) balance = outstanding;
          }
        }
        // no preparedInvoiceLineId at all means the item was prepared at a
        // zero price (nothing was ever charged) - nothing to check payment
        // against, so it releases unconditionally.
        if (!paid) {
          stillAwaiting.push({ itemId: it.id, drugName: it.drugName, reason: `Awaiting patient payment (balance: ${balance.toString()})` });
          continue;
        }
        await this.releaseItem(tx, actor, rx, it);
        released.push(it.id);
      }

      const freshItems = await tx.prescriptionItem.findMany({ where: { prescriptionId: id } });
      const status = computeDispenseStatus(freshItems);
      await tx.prescription.update({
        where: { id },
        data: {
          dispenseStatus: status,
          ...(released.length ? { dispensedById: actor.userId, dispensedAt: new Date() } : {}),
        },
      });
      return { released, stillAwaiting };
    });
  }

  private async releaseItem(tx: Prisma.TransactionClient, actor: Actor, rx: PrescriptionRow, it: PrescriptionItemRow) {
    if (it.drugId && it.preparedQty > 0) {
      await this.drawStockFefo(tx, {
        tenantId: actor.tenantId, userId: actor.userId, drugId: it.drugId,
        quantity: it.preparedQty, unitPrice: Number(it.preparedUnitPrice ?? 0),
        prescriptionId: rx.id, visitId: rx.visitId,
      });
    }
    await tx.prescriptionItem.update({
      where: { id: it.id },
      data: {
        dispensedQty: (it.dispensedQty ?? 0) + it.preparedQty,
        dispenseUnitPrice: it.preparedUnitPrice,
        preparedQty: 0, preparedUnitPrice: null, preparedInvoiceLineId: null, preparedAt: null, preparedById: null,
      },
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'RELEASE_DISPENSE',
      entityType: 'PrescriptionItem', entityId: it.id,
      metadata: { drugName: it.drugName, quantity: it.preparedQty },
    });
  }

  /**
   * If the patient never pays: void the preparation. The prepared charge is
   * an ordinary, still-unlocked InvoiceLine (nothing has paid it yet, by
   * construction - that is the whole point of the gate), so this reuses the
   * exact same primitive `BillingService.removeInvoiceLine` deletes with
   * (`voidInvoiceLine`) rather than going through that actor-gated method
   * itself, since a PHARMACIST has `prescription:dispense` but not
   * `billing:manage` - the dispense permission already covers authorizing
   * this specific action. One edge case `removeInvoiceLine` does not need to
   * handle but this does: if the prepared line is the invoice's only line,
   * the invoice is cancelled outright instead of being left with zero lines,
   * since pharmacy staff have no separate "cancel this invoice" tool to
   * reach for afterward.
   */
  async cancelPreparation(actor: Actor, id: string, itemId: string, dto: CancelPreparationDto) {
    assertCan(actor.role, 'prescription:dispense');
    if (!dto.reason?.trim()) {
      throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason is required to cancel a preparation' });
    }
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
      const rx = await tx.prescription.findFirst({ where: { id }, include: { items: true } });
      if (!rx) throw new NotFoundException('Prescription not found');
      const it = rx.items.find((x) => x.id === itemId);
      if (!it) throw new NotFoundException('Prescription item not found');
      if ((it.preparedQty ?? 0) <= 0) {
        throw new BadRequestException('This item has no prepared quantity to cancel');
      }

      if (it.preparedInvoiceLineId) {
        const line = await tx.invoiceLine.findFirst({ where: { id: it.preparedInvoiceLineId }, select: { invoiceId: true } });
        if (line) {
          const invoice = await tx.invoice.findFirst({
            where: { id: line.invoiceId },
            include: { payments: true, claim: true, lines: true },
          });
          if (invoice) {
            const locked = invoice.payments.some((p) => !p.reversedAt) || !!invoice.claim;
            if (locked) {
              throw new BadRequestException('This invoice already has a payment or claim on it and can no longer be edited - reverse it first.');
            }
            if (invoice.lines.length <= 1) {
              await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } });
              await this.audit.record({
                tenantId: actor.tenantId, userId: actor.userId, action: 'CANCEL', entityType: 'Invoice', entityId: invoice.id,
                metadata: { reason: dto.reason, source: 'cancel-preparation' },
              });
            } else {
              await this.billing.voidInvoiceLine(tx, it.preparedInvoiceLineId);
            }
          }
        }
      }

      await tx.prescriptionItem.update({
        where: { id: it.id },
        data: { preparedQty: 0, preparedUnitPrice: null, preparedInvoiceLineId: null, preparedAt: null, preparedById: null },
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'CANCEL_PREPARATION',
        entityType: 'PrescriptionItem', entityId: it.id,
        metadata: { drugName: it.drugName, quantity: it.preparedQty, reason: dto.reason },
      });

      const freshItems = await tx.prescriptionItem.findMany({ where: { prescriptionId: id } });
      const status = computeDispenseStatus(freshItems);
      await tx.prescription.update({ where: { id }, data: { dispenseStatus: status } });
      return { ok: true };
    });
  }

  /**
   * The catalogue (`Drug.sellPrice`) is the only authoritative price for a
   * formulary item - the same single-source-of-truth pattern the consultation
   * charge already uses (`ScheduleService`'s `ServiceItem.unitPrice`, never
   * client-suppliable). A client-sent `unitPrice` is trusted as an override
   * only for an actor with `billing:manage`, and only with a reason; from
   * anyone else it's logged as a mismatch and ignored. A missing/zero
   * catalogue price blocks the dispense rather than posting a free charge,
   * unless a privileged override explicitly sets a real price.
   *
   * Off-formulary (free-text, no drugId) items have no catalogue to resolve
   * against, so anyone dispensing one must give a reason - the price itself
   * isn't checked against anything, but who set it, what it was, and why is
   * always on record (FUNC-1 off-formulary decision).
   */
  private async resolveDispensePrice(
    tx: Prisma.TransactionClient,
    actor: Actor,
    visitId: string | null,
    it: { id: string; drugId: string | null; drugName: string },
    line: { unitPrice?: number; overrideReason?: string },
    delta: number,
    canOverride: boolean,
  ): Promise<number> {
    if (delta <= 0) return 0; // nothing new dispensed on this line - unused downstream

    if (!it.drugId) {
      if (!line.overrideReason?.trim()) {
        throw new BadRequestException(`A reason is required to dispense the off-formulary item "${it.drugName}"`);
      }
      const price = line.unitPrice ?? 0;
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'OFF_FORMULARY_DISPENSE',
        entityType: 'PrescriptionItem', entityId: it.id,
        metadata: { drugName: it.drugName, price, reason: line.overrideReason, visitId },
      });
      return price;
    }

    const drug = await tx.drug.findFirst({ where: { id: it.drugId }, select: { sellPrice: true } });
    const cataloguePrice = drug ? Number(drug.sellPrice) : 0;
    const requested = line.unitPrice;
    const mismatched = requested !== undefined && requested !== cataloguePrice;

    if (mismatched && canOverride) {
      if (!line.overrideReason?.trim()) {
        throw new BadRequestException(`A reason is required to charge a different price for ${it.drugName}`);
      }
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'DISPENSE_PRICE_OVERRIDE',
        entityType: 'PrescriptionItem', entityId: it.id,
        metadata: { drugId: it.drugId, drugName: it.drugName, cataloguePrice, overridePrice: requested, reason: line.overrideReason, visitId },
      });
      return requested as number;
    }

    if (mismatched) {
      this.log.warn(
        `Dispense price mismatch: user ${actor.userId} sent ${requested} for ${it.drugName} (catalogue ${cataloguePrice}); charging catalogue price.`,
      );
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'DISPENSE_PRICE_MISMATCH',
        entityType: 'PrescriptionItem', entityId: it.id,
        metadata: { drugId: it.drugId, drugName: it.drugName, cataloguePrice, requestedPrice: requested, visitId },
      });
    }

    if (cataloguePrice <= 0) {
      throw new BadRequestException(`No selling price set for ${it.drugName}. Ask an admin to set it in Pharmacy > Inventory.`);
    }
    return cataloguePrice;
  }

  /** Draw `quantity` from a drug's batches, earliest expiry first. Throws 409 if short. */
  private async drawStockFefo(
    tx: Prisma.TransactionClient,
    p: {
      tenantId: string;
      userId: string;
      drugId: string;
      quantity: number;
      unitPrice: number;
      prescriptionId: string;
      visitId: string | null;
    },
  ) {
    // A batch is treated as expired from the start of its printed expiry date
    // in Lagos time, not just "has the exact instant passed" (BL-2).
    const cutoff = lagosCalendarDate(new Date());
    // Fetch every batch with stock, expired or not, so a shortfall can say
    // *why* - "nothing left at all" reads very differently to a pharmacist
    // than "there's stock, but it's all expired."
    const allBatches = await tx.drugBatch.findMany({
      where: { drugId: p.drugId, quantity: { gt: 0 } },
      orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
    });
    const batches = allBatches.filter((b) => b.expiryDate > cutoff);
    const expired = allBatches.filter((b) => b.expiryDate <= cutoff);
    const available = batches.reduce((s, b) => s + b.quantity, 0);

    if (available < p.quantity) {
      const drug = await tx.drug.findFirst({ where: { id: p.drugId }, select: { name: true } });
      const name = drug?.name ?? 'this drug';

      if (available === 0 && expired.length > 0) {
        const detail = expired
          .slice(0, 3)
          .map((b) => `batch ${b.batchNumber} expired ${b.expiryDate.toISOString().slice(0, 10)}`)
          .join(', ');
        const more = expired.length > 3 ? `, +${expired.length - 3} more` : '';
        throw new ConflictException({
          code: 'EXPIRED_STOCK_ONLY',
          message: `Only expired stock remains for ${name} (${detail}${more}). Remove expired stock and restock.`,
          drugId: p.drugId,
          available: 0,
        });
      }

      if (available === 0) {
        throw new ConflictException({
          code: 'OUT_OF_STOCK',
          message: `${name} is out of stock.`,
          drugId: p.drugId,
          available: 0,
        });
      }

      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: `Not enough unexpired stock of ${name} (need ${p.quantity}, ${available} available)`,
        drugId: p.drugId,
        available,
      });
    }

    let remaining = p.quantity;
    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(b.quantity, remaining);
      await tx.drugBatch.update({ where: { id: b.id }, data: { quantity: { decrement: take } } });
      await tx.stockMovement.create({
        data: {
          tenantId: p.tenantId,
          drugId: p.drugId,
          batchId: b.id,
          type: 'DISPENSE',
          quantity: -take,
          unitPrice: new Prisma.Decimal(p.unitPrice),
          prescriptionId: p.prescriptionId,
          visitId: p.visitId,
          createdById: p.userId,
        },
      });
      remaining -= take;
    }
    await tx.drug.update({
      where: { id: p.drugId },
      data: { quantityOnHand: { decrement: p.quantity } },
    });
  }

  /**
   * A simple aggregate of off-formulary dispenses (drug name, how often, and
   * what prices were used) so an admin can spot which non-catalogue drugs
   * come up often enough to add to the formulary (FUNC-1 off-formulary
   * decision - point 3, visibility).
   */
  async offFormularyReport(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const items = await tx.prescriptionItem.findMany({
        where: { drugId: null, dispensedQty: { gt: 0 } },
        select: { drugName: true, dispenseUnitPrice: true },
      });
      const byName = new Map<string, { count: number; prices: Set<string> }>();
      for (const it of items) {
        const entry = byName.get(it.drugName) ?? { count: 0, prices: new Set<string>() };
        entry.count += 1;
        if (it.dispenseUnitPrice) entry.prices.add(it.dispenseUnitPrice.toString());
        byName.set(it.drugName, entry);
      }
      return [...byName.entries()]
        .map(([drugName, v]) => ({
          drugName,
          count: v.count,
          prices: [...v.prices].sort((a, b) => Number(a) - Number(b)),
        }))
        .sort((a, b) => b.count - a.count);
    });
  }

  /** Hospital-Admin-facing review of every emergency dispense override in a
   * date range (F2) - mirrors `BillingService.lineEditsReport`'s shape for
   * the same accountability reason: the roles who can trigger an override
   * can also review every one that happened. */
  async dispenseOverridesReport(tenantId: string, q: { from?: string; to?: string }) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const where: Prisma.AuditLogWhereInput = {
        entityType: 'Prescription', action: 'EMERGENCY_DISPENSE_OVERRIDE',
      };
      if (q.from || q.to) {
        where.createdAt = {
          ...(q.from ? { gte: new Date(q.from) } : {}),
          ...(q.to ? { lt: new Date(new Date(q.to).getTime() + 86_400_000) } : {}),
        };
      }
      const entries = await tx.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 1000 });
      const userIds = [...new Set(entries.map((e) => e.userId).filter((x): x is string => !!x))];
      const users = userIds.length
        ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
        : [];
      const nm = new Map(users.map((u) => [u.id, u.fullName]));
      return entries.map((e) => {
        const m = (e.metadata ?? {}) as Record<string, unknown>;
        return {
          id: e.id,
          createdAt: e.createdAt,
          prescriptionId: e.entityId,
          userName: e.userId ? nm.get(e.userId) ?? null : null,
          reason: (m.reason as string) ?? null,
          items: (m.items as unknown[]) ?? [],
        };
      });
    });
  }

  async cancel(actor: Actor, id: string) {
    assertCan(actor.role, 'prescription:dispense');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const rx = await tx.prescription.findFirst({ where: { id } });
      if (!rx) throw new NotFoundException('Prescription not found');
      const updated = await tx.prescription.update({
        where: { id },
        data: { dispenseStatus: 'CANCELLED' },
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'CANCEL_DISPENSE',
        entityType: 'Prescription', entityId: id,
      });
      return updated;
    });
  }
}

function appendNote(current: string | null, line: string): string {
  return current ? `${current}\n[Pharmacy] ${line}` : `[Pharmacy] ${line}`;
}
