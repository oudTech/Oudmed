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
import { DispenseDto } from './dto/pharmacy.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
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
        dispenseStatus: status ? (status as any) : { in: ['PENDING', 'PARTIAL'] },
      };
      const rows = await tx.prescription.findMany({
        where,
        include: {
          items: { include: { drug: { select: { sellPrice: true, quantityOnHand: true } } } },
          patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true } },
        },
        orderBy: { prescribedAt: 'desc' },
        take: 100,
      });
      const ids = [...new Set(rows.map((r) => r.prescribedById).filter(Boolean) as string[])];
      const users = ids.length
        ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
        : [];
      const nm = new Map(users.map((u) => [u.id, u.fullName]));
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
        if (rx.visitId) {
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

      const allDispensed = rx.items.every((it) => {
        const line = dto.items.find((l) => l.itemId === it.id);
        return line ? line.quantity > 0 : (it.dispensedQty ?? 0) > 0;
      });

      const updated = await tx.prescription.update({
        where: { id },
        data: {
          dispenseStatus: allDispensed ? 'DISPENSED' : 'PARTIAL',
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
      return updated;
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
    const now = new Date();
    const batches = await tx.drugBatch.findMany({
      where: { drugId: p.drugId, quantity: { gt: 0 }, expiryDate: { gt: now } },
      orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
    });
    const available = batches.reduce((s, b) => s + b.quantity, 0);
    if (available < p.quantity) {
      const drug = await tx.drug.findFirst({ where: { id: p.drugId }, select: { name: true } });
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: `Not enough stock of ${drug?.name ?? 'this drug'} (need ${p.quantity}, ${available} on hand)`,
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
