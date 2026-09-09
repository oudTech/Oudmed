import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { assertCan } from '../common/permissions';
import { DispenseDto } from './dto/pharmacy.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

@Injectable()
export class PharmacyService {
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

      // Each line's `quantity` is the cumulative quantity dispensed for that item
      // (the dispensing form pre-fills it with the item's current dispensedQty).
      // Only the increase over what is already recorded draws stock and posts a
      // charge - so replaying a completed dispense is a no-op, and a top-up
      // moves only the delta.
      const plan = dto.items.map((line) => {
        const it = byId.get(line.itemId);
        if (!it) throw new BadRequestException('Unknown prescription item');
        return { line, it, delta: line.quantity - (it.dispensedQty ?? 0) };
      });

      for (const p of plan) {
        if (p.delta <= 0) continue;
        await tx.prescriptionItem.update({
          where: { id: p.line.itemId },
          data: {
            dispensedQty: p.line.quantity,
            dispenseUnitPrice: new Prisma.Decimal(p.line.unitPrice),
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
          unitPrice: p.line.unitPrice,
          prescriptionId: rx.id,
          visitId: rx.visitId,
        });
      }

      // charge the delta only
      const billable = plan.filter((p) => p.delta > 0 && p.line.unitPrice > 0);
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
              unitPrice: p.line.unitPrice,
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
              unitPrice: p.line.unitPrice,
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
