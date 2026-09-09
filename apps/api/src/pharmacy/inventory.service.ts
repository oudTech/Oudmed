import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { assertCan } from '../common/permissions';
import {
  AdjustStockDto,
  CreateDrugDto,
  ListDrugsQueryDto,
  ReceiveBatchDto,
  UpdateDrugDto,
} from './dto/inventory.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

const PAGE_SIZE = 25;
const EXPIRING_DAYS = 60;
const SCAN_CAP = 1000;

const FORMS = new Set([
  'Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Ampoule', 'Vial',
  'Cream', 'Ointment', 'Drops', 'Inhaler', 'Suppository', 'Sachet', 'Other',
]);
const PACKAGING = new Set(['Pack', 'Bottle', 'Tube', 'Blister', 'Vial', 'Ampoule', 'Sachet', 'Each']);

function daysUntil(d: Date): number {
  return Math.round((d.getTime() - Date.now()) / 86_400_000);
}
function genSku(): string {
  return 'MED-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type BatchLite = { quantity: number; expiryDate: Date };

@Injectable()
export class PharmacyInventoryService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private shape(drug: any, batches: BatchLite[]) {
    const live = batches.filter((b) => b.quantity > 0);
    const nearest = live.length
      ? live.reduce((m, b) => (b.expiryDate < m ? b.expiryDate : m), live[0].expiryDate)
      : null;
    const expiringSoon = live.some((b) => daysUntil(b.expiryDate) <= EXPIRING_DAYS);
    const qty = drug.quantityOnHand;
    const stockStatus = qty <= 0 ? 'OUT' : qty <= drug.reorderLevel ? 'LOW' : 'OK';
    return {
      id: drug.id,
      sku: drug.sku,
      name: drug.name,
      genericName: drug.genericName,
      form: drug.form,
      strength: drug.strength,
      packaging: drug.packaging,
      unitLabel: drug.unitLabel,
      sellPrice: drug.sellPrice.toString(),
      costPrice: drug.costPrice ? drug.costPrice.toString() : null,
      reorderLevel: drug.reorderLevel,
      quantityOnHand: qty,
      stockStatus,
      nearestExpiry: nearest ? nearest.toISOString() : null,
      expiringSoon,
      isActive: drug.isActive,
    };
  }

  async list(tenantId: string, q: ListDrugsQueryDto) {
    const page = q.page && q.page > 0 ? q.page : 1;
    return this.prisma.forTenant(tenantId, async (tx) => {
      const where: Prisma.DrugWhereInput = { isActive: true };
      if (q.search) {
        where.OR = [
          { name: { contains: q.search, mode: 'insensitive' } },
          { genericName: { contains: q.search, mode: 'insensitive' } },
          { brandName: { contains: q.search, mode: 'insensitive' } },
          { sku: { contains: q.search, mode: 'insensitive' } },
        ];
      }
      const drugs = await tx.drug.findMany({
        where,
        include: { batches: { select: { quantity: true, expiryDate: true } } },
        orderBy: { name: 'asc' },
        take: SCAN_CAP,
      });

      let rows = drugs.map((d) => this.shape(d, d.batches));
      if (q.filter === 'low') rows = rows.filter((r) => r.stockStatus === 'LOW');
      else if (q.filter === 'out') rows = rows.filter((r) => r.stockStatus === 'OUT');
      else if (q.filter === 'expiring') rows = rows.filter((r) => r.expiringSoon);

      const total = rows.length;
      return {
        page,
        pageSize: PAGE_SIZE,
        total,
        drugs: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      };
    });
  }

  async stats(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const drugs = await tx.drug.findMany({
        where: { isActive: true },
        select: {
          quantityOnHand: true,
          reorderLevel: true,
          createdAt: true,
          batches: { select: { quantity: true, expiryDate: true } },
        },
        take: SCAN_CAP,
      });

      let low = 0;
      let out = 0;
      let expiring = 0;
      for (const d of drugs) {
        if (d.quantityOnHand <= 0) out++;
        else if (d.quantityOnHand <= d.reorderLevel) low++;
        if (d.batches.some((b) => b.quantity > 0 && daysUntil(b.expiryDate) <= EXPIRING_DAYS)) {
          expiring++;
        }
      }
      return {
        totalDrugs: {
          total: drugs.length,
          addedThisMonth: drugs.filter((d) => d.createdAt >= monthStart).length,
        },
        lowStock: { total: low },
        outOfStock: { total: out },
        expiringSoon: { total: expiring },
      };
    });
  }

  async search(tenantId: string, q: string) {
    if (!q || q.trim().length < 2) return [];
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.drug
        .findMany({
          where: {
            isActive: true,
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { genericName: { contains: q, mode: 'insensitive' } },
              { brandName: { contains: q, mode: 'insensitive' } },
            ],
          },
          orderBy: { name: 'asc' },
          take: 12,
          select: {
            id: true, name: true, form: true, strength: true,
            sellPrice: true, quantityOnHand: true,
          },
        })
        .then((list) =>
          list.map((d) => ({ ...d, sellPrice: d.sellPrice.toString() })),
        ),
    );
  }

  async getOne(tenantId: string, id: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const drug = await tx.drug.findFirst({
        where: { id },
        include: { batches: { orderBy: { expiryDate: 'asc' } } },
      });
      if (!drug) throw new NotFoundException('Drug not found');

      const since = new Date(Date.now() - 30 * 86_400_000);
      const movements = await tx.stockMovement.findMany({
        where: { drugId: id },
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: { batch: { select: { batchNumber: true } } },
      });
      const userIds = [...new Set(movements.map((m) => m.createdById).filter(Boolean) as string[])];
      const users = userIds.length
        ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
        : [];
      const nm = new Map(users.map((u) => [u.id, u.fullName]));

      // per-day series for the last 30 days
      const byDay = new Map<string, { dispensedQty: number; dispensedRevenue: number; receivedQty: number }>();
      for (let i = 0; i < 30; i++) {
        const d = new Date(Date.now() - i * 86_400_000);
        byDay.set(d.toISOString().slice(0, 10), { dispensedQty: 0, dispensedRevenue: 0, receivedQty: 0 });
      }
      for (const m of movements) {
        if (m.createdAt < since) continue;
        const key = m.createdAt.toISOString().slice(0, 10);
        const bucket = byDay.get(key);
        if (!bucket) continue;
        if (m.type === 'DISPENSE') {
          bucket.dispensedQty += -m.quantity;
          bucket.dispensedRevenue += -m.quantity * (m.unitPrice ? Number(m.unitPrice) : 0);
        } else if (m.type === 'RECEIVE' || m.type === 'OPENING' || m.type === 'RETURN') {
          bucket.receivedQty += m.quantity;
        }
      }
      const series = [...byDay.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, v]) => ({
          date,
          dispensedQty: v.dispensedQty,
          dispensedRevenue: v.dispensedRevenue.toFixed(2),
          receivedQty: v.receivedQty,
        }));

      return {
        ...this.shape(drug, drug.batches),
        comments: drug.comments,
        createdAt: drug.createdAt.toISOString(),
        updatedAt: drug.updatedAt.toISOString(),
        batches: drug.batches.map((b) => ({
          id: b.id,
          batchNumber: b.batchNumber,
          expiryDate: b.expiryDate.toISOString(),
          quantity: b.quantity,
          costPrice: b.costPrice ? b.costPrice.toString() : null,
          supplier: b.supplier,
          receivedAt: b.receivedAt.toISOString(),
          expired: b.expiryDate.getTime() < Date.now(),
          daysToExpiry: daysUntil(b.expiryDate),
        })),
        movements: movements.slice(0, 20).map((m) => ({
          id: m.id,
          type: m.type,
          quantity: m.quantity,
          unitPrice: m.unitPrice ? m.unitPrice.toString() : null,
          reason: m.reason,
          batchNumber: m.batch?.batchNumber ?? null,
          createdByName: m.createdById ? nm.get(m.createdById) ?? null : null,
          createdAt: m.createdAt.toISOString(),
        })),
        series,
      };
    });
  }

  async create(actor: Actor, dto: CreateDrugDto) {
    assertCan(actor.role, 'pharmacy:manage');
    const drug = await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const sku = await this.resolveSku(tx, actor.tenantId, dto.sku);
      const created = await tx.drug.create({
        data: {
          tenantId: actor.tenantId,
          sku,
          name: dto.name.trim(),
          genericName: dto.genericName,
          brandName: dto.brandName,
          form: dto.form,
          strength: dto.strength,
          packaging: dto.packaging || 'Pack',
          unitLabel: dto.unitLabel,
          sellPrice: new Prisma.Decimal(dto.sellPrice),
          costPrice: dto.costPrice != null ? new Prisma.Decimal(dto.costPrice) : null,
          reorderLevel: dto.reorderLevel ?? 20,
          comments: dto.comments,
          createdById: actor.userId,
        },
      });
      if (dto.openingStock) {
        await this.addBatch(tx, actor, created.id, {
          type: 'OPENING',
          quantity: dto.openingStock.quantity,
          expiryDate: new Date(dto.openingStock.expiryDate),
          batchNumber: dto.openingStock.batchNumber,
          costPrice: dto.openingStock.costPrice,
        });
      }
      return created;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'CREATE',
      entityType: 'Drug', entityId: drug.id, metadata: { name: drug.name },
    });
    return this.getOne(actor.tenantId, drug.id);
  }

  async update(actor: Actor, id: string, dto: UpdateDrugDto) {
    assertCan(actor.role, 'pharmacy:manage');
    await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const existing = await tx.drug.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Drug not found');
      const data: Prisma.DrugUpdateInput = {};
      for (const k of ['name', 'genericName', 'brandName', 'form', 'strength', 'packaging', 'unitLabel', 'comments', 'isActive'] as const) {
        if (dto[k] !== undefined) (data as any)[k] = k === 'name' ? String(dto[k]).trim() : dto[k];
      }
      if (dto.sku !== undefined) data.sku = await this.resolveSku(tx, actor.tenantId, dto.sku, id);
      if (dto.sellPrice !== undefined) data.sellPrice = new Prisma.Decimal(dto.sellPrice);
      if (dto.costPrice !== undefined)
        data.costPrice = dto.costPrice === null ? null : new Prisma.Decimal(dto.costPrice);
      if (dto.reorderLevel !== undefined) data.reorderLevel = dto.reorderLevel;
      await tx.drug.update({ where: { id }, data });
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE',
      entityType: 'Drug', entityId: id,
    });
    return this.getOne(actor.tenantId, id);
  }

  async remove(actor: Actor, id: string) {
    assertCan(actor.role, 'pharmacy:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const drug = await tx.drug.findFirst({ where: { id } });
      if (!drug) throw new NotFoundException('Drug not found');
      const moves = await tx.stockMovement.count({ where: { drugId: id } });
      if (moves > 0) {
        await tx.drug.update({ where: { id }, data: { isActive: false } });
        await this.audit.record({
          tenantId: actor.tenantId, userId: actor.userId, action: 'ARCHIVE',
          entityType: 'Drug', entityId: id,
        });
        return { ok: true, softDeleted: true };
      }
      await tx.drugBatch.deleteMany({ where: { drugId: id } });
      await tx.drug.delete({ where: { id } });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'DELETE',
        entityType: 'Drug', entityId: id,
      });
      return { ok: true, softDeleted: false };
    });
  }

  async receiveBatch(actor: Actor, id: string, dto: ReceiveBatchDto) {
    assertCan(actor.role, 'pharmacy:manage');
    await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const drug = await tx.drug.findFirst({ where: { id } });
      if (!drug) throw new NotFoundException('Drug not found');
      await this.addBatch(tx, actor, id, {
        type: 'RECEIVE',
        quantity: dto.quantity,
        expiryDate: new Date(dto.expiryDate),
        batchNumber: dto.batchNumber,
        costPrice: dto.costPrice,
        supplier: dto.supplier,
      });
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'RECEIVE_STOCK',
      entityType: 'Drug', entityId: id, metadata: { quantity: dto.quantity },
    });
    return this.getOne(actor.tenantId, id);
  }

  /**
   * Recompute the denormalised `Drug.quantityOnHand` cache from the batches
   * (the source of truth), and flag any drug where the signed StockMovement
   * ledger disagrees with the batch totals. Manual admin action for now; a
   * scheduled job later.
   */
  async reconcileStock(actor: Actor) {
    assertCan(actor.role, 'pharmacy:manage');
    const report = await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const [drugs, batchSums, moveSums] = await Promise.all([
        tx.drug.findMany({ select: { id: true, name: true, quantityOnHand: true } }),
        tx.drugBatch.groupBy({ by: ['drugId'], _sum: { quantity: true } }),
        tx.stockMovement.groupBy({ by: ['drugId'], _sum: { quantity: true } }),
      ]);
      const batchByDrug = new Map(batchSums.map((r) => [r.drugId, r._sum.quantity ?? 0]));
      const moveByDrug = new Map(moveSums.map((r) => [r.drugId, r._sum.quantity ?? 0]));

      const corrected: { drugId: string; name: string; was: number; now: number }[] = [];
      const ledgerMismatch: { drugId: string; name: string; batches: number; movements: number }[] = [];

      for (const d of drugs) {
        const batches = batchByDrug.get(d.id) ?? 0;
        const movements = moveByDrug.get(d.id) ?? 0;
        if (batches !== movements) {
          ledgerMismatch.push({ drugId: d.id, name: d.name, batches, movements });
        }
        if (d.quantityOnHand !== batches) {
          await tx.drug.update({ where: { id: d.id }, data: { quantityOnHand: batches } });
          corrected.push({ drugId: d.id, name: d.name, was: d.quantityOnHand, now: batches });
        }
      }
      return { checked: drugs.length, corrected, ledgerMismatch };
    });

    if (report.corrected.length || report.ledgerMismatch.length) {
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'RECONCILE_STOCK',
        entityType: 'Drug',
        metadata: {
          checked: report.checked,
          corrected: report.corrected.length,
          ledgerMismatch: report.ledgerMismatch.length,
        },
      });
    }
    return report;
  }

  async adjust(actor: Actor, id: string, dto: AdjustStockDto) {
    assertCan(actor.role, 'pharmacy:manage');
    if (dto.delta === 0) throw new BadRequestException('Adjustment must be non-zero');
    await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const drug = await tx.drug.findFirst({ where: { id } });
      if (!drug) throw new NotFoundException('Drug not found');
      if (drug.quantityOnHand + dto.delta < 0) {
        throw new BadRequestException('Adjustment would make stock negative');
      }
      if (dto.delta < 0) {
        let remaining = -dto.delta;
        const batches = await tx.drugBatch.findMany({
          where: { drugId: id, quantity: { gt: 0 } },
          orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
        });
        for (const b of batches) {
          if (remaining <= 0) break;
          const take = Math.min(b.quantity, remaining);
          await tx.drugBatch.update({ where: { id: b.id }, data: { quantity: { decrement: take } } });
          remaining -= take;
        }
      } else {
        const newest = await tx.drugBatch.findFirst({
          where: { drugId: id },
          orderBy: { receivedAt: 'desc' },
        });
        if (newest) {
          await tx.drugBatch.update({ where: { id: newest.id }, data: { quantity: { increment: dto.delta } } });
        } else {
          const far = new Date();
          far.setFullYear(far.getFullYear() + 2);
          await tx.drugBatch.create({
            data: {
              tenantId: actor.tenantId, drugId: id, quantity: dto.delta,
              expiryDate: far, batchNumber: 'ADJ', receivedById: actor.userId,
            },
          });
        }
      }
      await tx.stockMovement.create({
        data: {
          tenantId: actor.tenantId, drugId: id, type: 'ADJUST',
          quantity: dto.delta, reason: dto.reason, createdById: actor.userId,
        },
      });
      await tx.drug.update({ where: { id }, data: { quantityOnHand: { increment: dto.delta } } });
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'ADJUST_STOCK',
      entityType: 'Drug', entityId: id, metadata: { delta: dto.delta, reason: dto.reason },
    });
    return this.getOne(actor.tenantId, id);
  }

  async importDrugs(actor: Actor, rows: Record<string, unknown>[]) {
    assertCan(actor.role, 'pharmacy:manage');
    const result = { created: 0, updated: 0, skipped: 0, errors: [] as { row: number; message: string }[] };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 1;
      const get = (k: string) => {
        const v = r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()];
        return typeof v === 'string' ? v.trim() : v;
      };
      try {
        const name = String(get('name') ?? '').trim();
        if (name.length < 2) throw new Error('Missing drug name');
        const sellPrice = num(get('sellPrice') ?? get('price'));
        if (sellPrice === null || sellPrice < 0) throw new Error('Invalid sell price');
        const form = get('form') ? String(get('form')) : undefined;
        if (form && !FORMS.has(form)) throw new Error(`Unknown form "${form}"`);
        let packaging = get('packaging') ? String(get('packaging')) : 'Pack';
        if (!PACKAGING.has(packaging)) packaging = 'Pack';
        const openingQty = num(get('openingQuantity') ?? get('quantity'));
        let expiry: Date | null = null;
        if (openingQty && openingQty > 0) {
          const raw = get('expiryDate') ?? get('expiry');
          const d = raw ? new Date(String(raw)) : null;
          if (!d || Number.isNaN(d.getTime())) throw new Error('Opening stock needs a valid expiry date');
          expiry = d;
        }
        const sku = get('sku') ? String(get('sku')) : undefined;

        await this.prisma.forTenant(actor.tenantId, async (tx) => {
          let existing = sku
            ? await tx.drug.findFirst({ where: { sku } })
            : await tx.drug.findFirst({
                where: {
                  name: { equals: name, mode: 'insensitive' },
                  strength: get('strength') ? String(get('strength')) : null,
                },
              });

          const fields = {
            name,
            genericName: get('genericName') ? String(get('genericName')) : undefined,
            form,
            strength: get('strength') ? String(get('strength')) : undefined,
            packaging,
            unitLabel: get('unitLabel') ? String(get('unitLabel')) : undefined,
            sellPrice: new Prisma.Decimal(sellPrice),
            costPrice: num(get('costPrice')) != null ? new Prisma.Decimal(num(get('costPrice'))!) : undefined,
            reorderLevel: num(get('reorderLevel')) != null ? Math.trunc(num(get('reorderLevel'))!) : undefined,
          };

          if (existing) {
            await tx.drug.update({ where: { id: existing.id }, data: fields });
            result.updated++;
          } else {
            existing = await tx.drug.create({
              data: {
                tenantId: actor.tenantId,
                sku: await this.resolveSku(tx, actor.tenantId, sku),
                createdById: actor.userId,
                ...fields,
              },
            });
            result.created++;
          }
          if (openingQty && openingQty > 0 && expiry) {
            await this.addBatch(tx, actor, existing.id, {
              type: 'RECEIVE',
              quantity: Math.trunc(openingQty),
              expiryDate: expiry,
              batchNumber: get('batchNumber') ? String(get('batchNumber')) : undefined,
            });
          }
        });
      } catch (e: any) {
        result.skipped++;
        result.errors.push({ row: rowNum, message: e?.message ?? 'Could not import row' });
      }
    }

    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'IMPORT_DRUGS',
      entityType: 'Drug', metadata: { created: result.created, updated: result.updated, skipped: result.skipped },
    });
    return result;
  }

  // ── internals ──

  private async resolveSku(
    tx: Prisma.TransactionClient,
    tenantId: string,
    requested: string | undefined,
    selfId?: string,
  ): Promise<string> {
    if (requested && requested.trim()) {
      const clash = await tx.drug.findFirst({
        where: { sku: requested.trim(), id: selfId ? { not: selfId } : undefined },
        select: { id: true },
      });
      if (clash) throw new BadRequestException(`SKU "${requested.trim()}" is already in use`);
      return requested.trim();
    }
    for (let i = 0; i < 6; i++) {
      const candidate = genSku();
      const clash = await tx.drug.findFirst({ where: { sku: candidate }, select: { id: true } });
      if (!clash) return candidate;
    }
    return genSku() + Date.now().toString(36).slice(-3).toUpperCase();
  }

  private async addBatch(
    tx: Prisma.TransactionClient,
    actor: Actor,
    drugId: string,
    b: {
      type: 'OPENING' | 'RECEIVE';
      quantity: number;
      expiryDate: Date;
      batchNumber?: string;
      costPrice?: number;
      supplier?: string;
    },
  ) {
    const batch = await tx.drugBatch.create({
      data: {
        tenantId: actor.tenantId,
        drugId,
        batchNumber: b.batchNumber,
        expiryDate: b.expiryDate,
        quantity: b.quantity,
        costPrice: b.costPrice != null ? new Prisma.Decimal(b.costPrice) : null,
        supplier: b.supplier,
        receivedById: actor.userId,
      },
    });
    await tx.stockMovement.create({
      data: {
        tenantId: actor.tenantId,
        drugId,
        batchId: batch.id,
        type: b.type,
        quantity: b.quantity,
        createdById: actor.userId,
      },
    });
    await tx.drug.update({
      where: { id: drugId },
      data: { quantityOnHand: { increment: b.quantity } },
    });
    return batch;
  }
}
