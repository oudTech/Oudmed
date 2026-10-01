import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { assertCan, can } from '../common/permissions';
import { AddNoteAddendumDto, CreateOrderDto, UpdateOrderDto, UpsertNoteDto } from './dto/encounter.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

const ORDER_CATEGORY: Record<OrderType, string> = {
  LABORATORY: 'Laboratory',
  IMAGING: 'Imaging',
  PROCEDURE: 'Procedure',
};

function ageFrom(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

@Injectable()
export class EncountersService {
  private readonly log = new Logger(EncountersService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private billing: BillingService,
  ) {}

  private async names(tx: Prisma.TransactionClient, ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const users = await tx.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  async getEncounter(actor: Actor, visitId: string) {
    assertCan(actor.role, 'patient:read');
    const { tenantId } = actor;
    return this.prisma.forTenant(tenantId, async (tx) => {
      const visit = await tx.visit.findFirst({
        where: { id: visitId },
        include: {
          patient: true,
          doctor: { select: { id: true, fullName: true } },
          department: { select: { id: true, name: true } },
        },
      });
      if (!visit) throw new NotFoundException('Visit not found');
      const p = visit.patient;

      const [complaints, vitals, diagnoses, orders, prescriptions, note, addenda, invoices, lastVitals] =
        await Promise.all([
          tx.complaint.findMany({ where: { visitId }, orderBy: { recordedAt: 'desc' } }),
          tx.vitalSigns.findMany({ where: { visitId }, orderBy: { recordedAt: 'desc' } }),
          tx.diagnosis.findMany({ where: { visitId }, orderBy: { diagnosedAt: 'desc' } }),
          tx.clinicalOrder.findMany({ where: { visitId }, orderBy: { orderedAt: 'desc' } }),
          tx.prescription.findMany({
            where: { visitId },
            include: { items: true },
            orderBy: { prescribedAt: 'desc' },
          }),
          tx.clinicalNote.findFirst({ where: { visitId } }),
          tx.clinicalNoteAddendum.findMany({ where: { visitId }, orderBy: { createdAt: 'asc' } }),
          // A visit may carry a supplementary invoice once its primary is
          // locked by a payment or a claim (FUNC-2) - show both.
          tx.invoice.findMany({ where: { visitId }, include: { lines: true, payments: true } }),
          tx.vitalSigns.findFirst({ where: { patientId: p.id }, orderBy: { recordedAt: 'desc' } }),
        ]);

      const nameMap = await this.names(tx, [
        ...complaints.map((c) => c.recordedById),
        ...vitals.map((v) => v.recordedById),
        ...diagnoses.map((d) => d.diagnosedById),
        ...orders.flatMap((o) => [o.orderedById, o.resultedById]),
        ...prescriptions.map((r) => r.prescribedById),
        note?.authorId,
        ...addenda.map((a) => a.authorId),
      ]);
      const nm = (id: string | null) => (id ? nameMap.get(id) ?? null : null);

      // "Late entry" once the visit was already completed at the time it was
      // recorded (FUNC-2) - complaint/vitals/diagnosis stay append-only after
      // completion rather than being blocked, so this just labels them.
      const isLate = (recordedAt: Date) => !!visit.completedAt && recordedAt > visit.completedAt;

      return {
        visit: {
          id: visit.id,
          visitType: visit.visitType,
          status: visit.status,
          startsAt: visit.startsAt,
          endsAt: visit.endsAt,
          reason: visit.reason,
          startedAt: visit.startedAt,
          completedAt: visit.completedAt,
          reopenedAt: visit.reopenedAt,
          doctor: visit.doctor,
          department: visit.department,
        },
        patient: {
          id: p.id,
          patientNumber: p.patientNumber,
          firstName: p.firstName,
          middleName: p.middleName,
          lastName: p.lastName,
          age: ageFrom(p.dateOfBirth),
          gender: p.gender,
          bloodGroup: p.bloodGroup,
          genotype: p.genotype,
          allergies: p.allergies,
          chronicConditions: p.chronicConditions,
          currentMedications: p.currentMedications,
          payerType: p.payerType,
          hmoName: p.hmoName,
        },
        lastVitals: lastVitals ?? null,
        complaints: complaints.map((c) => ({
          ...c, recordedByName: nm(c.recordedById), lateEntry: isLate(c.recordedAt),
        })),
        vitals: vitals.map((v) => ({
          ...v, recordedByName: nm(v.recordedById), lateEntry: isLate(v.recordedAt),
        })),
        diagnoses: diagnoses.map((d) => ({
          ...d, recordedByName: nm(d.diagnosedById), lateEntry: isLate(d.diagnosedAt),
        })),
        orders: orders.map((o) => ({
          ...o,
          orderedByName: nm(o.orderedById),
          resultedByName: nm(o.resultedById),
        })),
        prescriptions: prescriptions.map((r) => ({
          ...r,
          prescribedByName: nm(r.prescribedById),
          dispensedByName: nm(r.dispensedById),
        })),
        note: note
          ? { ...note, authorName: nm(note.authorId) }
          : null,
        noteAddenda: addenda.map((a) => ({ ...a, authorName: nm(a.authorId) })),
        invoices: invoices.map((invoice) => {
          const paid = invoice.payments.reduce((s, x) => s.add(x.amount), new Prisma.Decimal(0));
          const total = invoice.totalAmount;
          return {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            isSupplementary: invoice.isSupplementary,
            supplementOfInvoiceId: invoice.supplementOfInvoiceId,
            reopenFlaggedAt: invoice.reopenFlaggedAt,
            reopenAcknowledgedAt: invoice.reopenAcknowledgedAt,
            totalAmount: total.toString(),
            paidAmount: paid.toString(),
            balanceDue: (total.sub(paid).lt(0) ? new Prisma.Decimal(0) : total.sub(paid)).toString(),
            lines: invoice.lines.map((l) => ({
              id: l.id,
              category: l.category,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice.toString(),
              lineTotal: l.lineTotal.toString(),
            })),
          };
        }),
      };
    });
  }

  async upsertNote(actor: Actor, visitId: string, dto: UpsertNoteDto) {
    assertCan(actor.role, 'note:write');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const visit = await tx.visit.findFirst({ where: { id: visitId }, select: { id: true, patientId: true, status: true } });
      if (!visit) throw new NotFoundException('Visit not found');
      if (visit.status === 'COMPLETED') {
        throw new BadRequestException({
          message: 'This visit is completed. Reopen it to edit the note, or add an addendum instead.',
          code: 'VISIT_COMPLETED',
        });
      }
      const row = await tx.clinicalNote.upsert({
        where: { visitId },
        create: {
          tenantId: actor.tenantId,
          patientId: visit.patientId,
          visitId,
          subjective: dto.subjective,
          objective: dto.objective,
          assessment: dto.assessment,
          plan: dto.plan,
          authorId: actor.userId,
        },
        update: {
          subjective: dto.subjective ?? null,
          objective: dto.objective ?? null,
          assessment: dto.assessment ?? null,
          plan: dto.plan ?? null,
          authorId: actor.userId,
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'SAVE_NOTE',
        entityType: 'Visit', entityId: visitId,
      });
      return row;
    });
  }

  /**
   * A late addition to the SOAP note after the visit was already completed
   * (upsertNote itself is blocked once completed - see above). Deliberately a
   * separate, append-only row rather than editing ClinicalNote, so the
   * original note is never silently changed; never blocked by completion,
   * the same as complaint/vitals/diagnosis (FUNC-2).
   */
  async addNoteAddendum(actor: Actor, visitId: string, dto: AddNoteAddendumDto) {
    assertCan(actor.role, 'note:write');
    if (!dto.subjective && !dto.objective && !dto.assessment && !dto.plan) {
      throw new BadRequestException('An addendum needs at least one field filled in');
    }
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const visit = await tx.visit.findFirst({ where: { id: visitId }, select: { id: true, patientId: true } });
      if (!visit) throw new NotFoundException('Visit not found');
      const row = await tx.clinicalNoteAddendum.create({
        data: {
          tenantId: actor.tenantId,
          patientId: visit.patientId,
          visitId,
          subjective: dto.subjective,
          objective: dto.objective,
          assessment: dto.assessment,
          plan: dto.plan,
          authorId: actor.userId,
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'ADD_NOTE_ADDENDUM',
        entityType: 'Visit', entityId: visitId, metadata: { addendumId: row.id },
      });
      return row;
    });
  }

  async createOrder(actor: Actor, visitId: string, dto: CreateOrderDto) {
    assertCan(actor.role, 'order:create');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const visit = await tx.visit.findFirst({
        where: { id: visitId },
        select: { id: true, patientId: true, status: true },
      });
      if (!visit) throw new NotFoundException('Visit not found');
      if (visit.status === 'COMPLETED') {
        throw new BadRequestException({
          message: 'This visit is completed. Reopen it to add orders.',
          code: 'VISIT_COMPLETED',
        });
      }

      let name = dto.name?.trim();
      let serviceItemId: string | null = dto.serviceItemId ?? null;
      let svc: { name: string; unitPrice: Prisma.Decimal } | null = null;
      if (serviceItemId) {
        svc = await tx.serviceItem.findFirst({ where: { id: serviceItemId }, select: { name: true, unitPrice: true } });
        if (!svc) throw new BadRequestException('Service item not found');
        name = name || svc.name;
      }
      if (!name) throw new BadRequestException('An order needs a name or a service item');
      const quantity = dto.quantity ?? 1;

      const order = await tx.clinicalOrder.create({
        data: {
          tenantId: actor.tenantId,
          patientId: visit.patientId,
          visitId,
          serviceItemId,
          orderType: dto.orderType,
          name,
          priority: dto.priority,
          clinicalNote: dto.clinicalNote,
          orderedById: actor.userId,
        },
      });

      // A catalogue-linked order resolves its price server-side, the same way
      // pharmacy dispensing does (see PharmacyService.resolveDispensePrice). A
      // free-text (non-catalogue) order has nothing to resolve against, so -
      // same as an off-formulary drug - it always needs a reason on record,
      // even though the shipped UI never actually places one of these today.
      let unitPrice: Prisma.Decimal;
      if (serviceItemId && svc) {
        unitPrice = await this.resolveOrderPrice(actor, visitId, order.id, name, svc.unitPrice, dto, can(actor.role, 'billing:manage'));
      } else {
        if (!dto.overrideReason?.trim()) {
          throw new BadRequestException(`A reason is required to price the off-catalogue order "${name}"`);
        }
        unitPrice = new Prisma.Decimal(dto.unitPrice ?? 0);
        await this.audit.record({
          tenantId: actor.tenantId, userId: actor.userId, action: 'OFF_CATALOGUE_ORDER',
          entityType: 'ClinicalOrder', entityId: order.id,
          metadata: { name, price: Number(unitPrice), reason: dto.overrideReason, visitId },
        });
      }

      // This order's source is the visit it was raised from (F1, corrected):
      // it always charges that visit's invoice, even if the patient happens
      // to be admitted right now. A patient's live admission status is not
      // the order's source - only the inpatient workspace's own order
      // creation (F1b) charges an admission directly.
      const { lineId } = await this.billing.postChargeToVisit(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        visitId,
        patientId: visit.patientId,
        serviceItemId,
        orderId: order.id,
        description: name,
        quantity,
        unitPrice,
        category: ORDER_CATEGORY[dto.orderType],
      });
      await tx.clinicalOrder.update({ where: { id: order.id }, data: { invoiceLineId: lineId } });

      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'CREATE_ORDER',
        entityType: 'ClinicalOrder', entityId: order.id,
        metadata: { orderType: dto.orderType, name },
      });
      return { ...order, invoiceLineId: lineId };
    });
  }

  /**
   * The service catalogue (`ServiceItem.unitPrice`) is the only authoritative
   * price for a catalogue-linked order - same pattern as
   * PharmacyService.resolveDispensePrice. A client-sent unitPrice is trusted
   * as an override only for an actor with billing:manage, and only with a
   * reason; from anyone else it's logged as a mismatch and ignored. A
   * missing/zero catalogue price blocks the order rather than posting a free
   * charge, unless a privileged override explicitly sets a real price.
   */
  private async resolveOrderPrice(
    actor: Actor,
    visitId: string,
    orderId: string,
    itemName: string,
    cataloguePriceDecimal: Prisma.Decimal,
    dto: { unitPrice?: number; overrideReason?: string },
    canOverride: boolean,
  ): Promise<Prisma.Decimal> {
    const cataloguePrice = Number(cataloguePriceDecimal);
    const requested = dto.unitPrice;
    const mismatched = requested !== undefined && requested !== cataloguePrice;

    if (mismatched && canOverride) {
      if (!dto.overrideReason?.trim()) {
        throw new BadRequestException(`A reason is required to charge a different price for ${itemName}`);
      }
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'ORDER_PRICE_OVERRIDE',
        entityType: 'ClinicalOrder', entityId: orderId,
        metadata: { itemName, cataloguePrice, overridePrice: requested, reason: dto.overrideReason, visitId },
      });
      return new Prisma.Decimal(requested as number);
    }

    if (mismatched) {
      this.log.warn(
        `Order price mismatch: user ${actor.userId} sent ${requested} for ${itemName} (catalogue ${cataloguePrice}); charging catalogue price.`,
      );
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'ORDER_PRICE_MISMATCH',
        entityType: 'ClinicalOrder', entityId: orderId,
        metadata: { itemName, cataloguePrice, requestedPrice: requested, visitId },
      });
    }

    if (cataloguePrice <= 0) {
      throw new BadRequestException(`No price set for ${itemName}. Ask an admin to set it in Administration > Services.`);
    }
    return cataloguePriceDecimal;
  }

  async updateOrder(actor: Actor, orderId: string, dto: UpdateOrderDto) {
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const order = await tx.clinicalOrder.findFirst({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Order not found');

      const hasResult =
        dto.resultValue !== undefined ||
        dto.resultUnit !== undefined ||
        dto.referenceRange !== undefined ||
        dto.abnormalFlag !== undefined ||
        dto.resultNote !== undefined;
      const targetStatus = dto.status ?? (hasResult ? 'RESULTED' : undefined);

      if (targetStatus === 'CANCELLED') {
        if (!this.can(actor.role, 'order:create') && !this.can(actor.role, 'order:result')) {
          throw new ForbiddenException({ code: 'FORBIDDEN_ACTION', message: 'Cannot cancel this order' });
        }
        if (order.status === 'RESULTED') {
          throw new BadRequestException('A resulted order cannot be cancelled');
        }
        if (order.invoiceLineId) await this.billing.voidInvoiceLine(tx, order.invoiceLineId);
        const row = await tx.clinicalOrder.update({
          where: { id: orderId },
          data: { status: 'CANCELLED', invoiceLineId: null },
        });
        await this.audit.record({
          tenantId: actor.tenantId, userId: actor.userId, action: 'CANCEL_ORDER',
          entityType: 'ClinicalOrder', entityId: orderId,
        });
        return row;
      }

      // result entry or IN_PROGRESS
      assertCan(actor.role, 'order:result');
      const data: Prisma.ClinicalOrderUpdateInput = {};
      if (hasResult || targetStatus === 'RESULTED') {
        data.resultValue = dto.resultValue ?? order.resultValue;
        data.resultUnit = dto.resultUnit ?? order.resultUnit;
        data.referenceRange = dto.referenceRange ?? order.referenceRange;
        data.abnormalFlag = dto.abnormalFlag ?? order.abnormalFlag;
        data.resultNote = dto.resultNote ?? order.resultNote;
        data.status = 'RESULTED';
        data.resultedById = actor.userId;
        data.resultedAt = new Date();
      } else if (targetStatus === 'IN_PROGRESS') {
        data.status = 'IN_PROGRESS';
      }
      const row = await tx.clinicalOrder.update({ where: { id: orderId }, data });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE_ORDER',
        entityType: 'ClinicalOrder', entityId: orderId, metadata: { status: row.status },
      });
      return row;
    });
  }

  private can(role: string, action: any): boolean {
    try {
      assertCan(role, action);
      return true;
    } catch {
      return false;
    }
  }

  // worklist for the lab screen
  async labWorklist(tenantId: string, status?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const where: Prisma.ClinicalOrderWhereInput = {
        orderType: { in: ['LABORATORY', 'IMAGING'] },
        status: status
          ? (status as any)
          : { in: ['ORDERED', 'IN_PROGRESS'] },
      };
      const orders = await tx.clinicalOrder.findMany({
        where,
        orderBy: { orderedAt: 'asc' },
        include: {
          patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true } },
        },
      });
      const nm = await this.names(tx, [...orders.map((o) => o.orderedById), ...orders.map((o) => o.resultedById)]);
      return orders.map((o) => ({
        id: o.id,
        orderType: o.orderType,
        name: o.name,
        status: o.status,
        priority: o.priority,
        clinicalNote: o.clinicalNote,
        orderedAt: o.orderedAt,
        orderedByName: o.orderedById ? nm.get(o.orderedById) ?? null : null,
        patient: o.patient,
        resultValue: o.resultValue,
        resultUnit: o.resultUnit,
        referenceRange: o.referenceRange,
        abnormalFlag: o.abnormalFlag,
        resultNote: o.resultNote,
        resultedByName: o.resultedById ? nm.get(o.resultedById) ?? null : null,
        resultedAt: o.resultedAt,
      }));
    });
  }
}
