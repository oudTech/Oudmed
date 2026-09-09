import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClaimStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { assertCan } from '../common/permissions';
import { nextSequence, type SequenceKind } from '../common/sequence';
import {
  BatchClaimsDto,
  ClaimLineDto,
  ClaimListQueryDto,
  CreateBatchDto,
  CreateClaimDto,
  CreateRemittanceDto,
  EligibleVisitsQueryDto,
  GenerateClaimsDto,
  ListQueryDto,
  OpenClaimsQueryDto,
  ReasonDto,
  SubmitBatchDto,
  SubmitClaimDto,
  UpdateClaimDto,
} from './dto/claims.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

const PAGE_SIZE = 25;
const D0 = () => new Prisma.Decimal(0);
const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2);
const s = (d: Prisma.Decimal | null | undefined) => (d ?? D0()).toString();
const ACTIVE_RECEIVABLE: ClaimStatus[] = [ClaimStatus.SUBMITTED, ClaimStatus.PART_PAID];

@Injectable()
export class ClaimsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private billing: BillingService,
  ) {}

  // ─────────────────────────── helpers ───────────────────────────

  private async nextSeq(
    tx: Prisma.TransactionClient,
    model: 'insuranceClaim' | 'claimBatch' | 'claimRemittance',
    tenantId: string,
    prefix: string,
  ) {
    const kind: SequenceKind =
      model === 'insuranceClaim' ? 'claim' : model === 'claimBatch' ? 'claimBatch' : 'remittance';
    const n = await nextSequence(tx, tenantId, kind, () =>
      (tx as any)[model].count({ where: { tenantId } }),
    );
    return `${prefix}-${String(n).padStart(6, '0')}`;
  }

  /**
   * Receipt number for the Payment a remittance posts on an invoice. Shares the
   * `receipt` counter with BillingService so the two receipt sources never
   * collide, and uses the tenant's configured receipt prefix.
   */
  private async nextReceipt(tx: Prisma.TransactionClient, tenantId: string) {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { receiptPrefix: true },
    });
    const n = await nextSequence(tx, tenantId, 'receipt', () =>
      tx.payment.count({ where: { tenantId, receiptNumber: { not: null } } }),
    );
    return `${tenant?.receiptPrefix || 'RCP'}-${String(n).padStart(6, '0')}`;
  }

  private outstanding(c: {
    claimedAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    writeOffAmount: Prisma.Decimal;
  }) {
    const o = c.claimedAmount.sub(c.paidAmount).sub(c.writeOffAmount);
    return o.lt(0) ? D0() : o;
  }

  /** Post a signed adjustment line on an invoice and re-total it. */
  private async postAdjustment(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
    amount: Prisma.Decimal,
    description: string,
    userId: string,
  ) {
    await tx.invoiceLine.create({
      data: {
        tenantId,
        invoiceId,
        category: 'HMO Adjustment',
        description,
        quantity: 1,
        unitPrice: amount,
        grossAmount: amount,
        lineTotal: amount,
        providedById: userId,
        providedAt: new Date(),
      },
    });
    await this.billing.recomputeInvoice(tx, invoiceId);
  }

  private async recomputeBatch(tx: Prisma.TransactionClient, batchId: string) {
    const claims = await tx.insuranceClaim.findMany({
      where: { batchId },
      select: { claimedAmount: true, approvedAmount: true, paidAmount: true },
    });
    await tx.claimBatch.update({
      where: { id: batchId },
      data: {
        claimCount: claims.length,
        claimedTotal: claims.reduce((a, c) => a.add(c.claimedAmount), D0()),
        approvedTotal: claims.reduce((a, c) => a.add(c.approvedAmount ?? D0()), D0()),
        paidTotal: claims.reduce((a, c) => a.add(c.paidAmount), D0()),
      },
    });
  }

  private async names(tx: Prisma.TransactionClient, ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  // ─────────────────────────── claims list + detail ───────────────────────────

  async listClaims(actor: Actor, q: ClaimListQueryDto) {
    assertCan(actor.role, 'claims:manage');
    const page = q.page && q.page > 0 ? q.page : 1;
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const where: Prisma.InsuranceClaimWhereInput = {};
      if (q.status) where.status = q.status as ClaimStatus;
      if (q.providerId) where.providerId = q.providerId;
      if (q.batchId) where.batchId = q.batchId;
      if (q.from || q.to) {
        where.serviceDate = {};
        if (q.from) (where.serviceDate as any).gte = new Date(q.from);
        if (q.to) (where.serviceDate as any).lte = new Date(`${q.to}T23:59:59`);
      }
      if (q.search) {
        where.OR = [
          { claimNumber: { contains: q.search, mode: 'insensitive' } },
          { memberNumber: { contains: q.search, mode: 'insensitive' } },
          { memberName: { contains: q.search, mode: 'insensitive' } },
          { patient: { firstName: { contains: q.search, mode: 'insensitive' } } },
          { patient: { lastName: { contains: q.search, mode: 'insensitive' } } },
        ];
      }

      const [total, rows, summary] = await Promise.all([
        tx.insuranceClaim.count({ where }),
        tx.insuranceClaim.findMany({
          where,
          include: {
            provider: { select: { name: true } },
            patient: { select: { firstName: true, lastName: true, patientNumber: true } },
            batch: { select: { batchNumber: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
        this.receivablesSummary(tx),
      ]);

      return {
        page,
        pageSize: PAGE_SIZE,
        total,
        summary,
        rows: rows.map((c) => this.shapeListItem(c)),
      };
    });
  }

  private shapeListItem(c: any) {
    return {
      id: c.id,
      claimNumber: c.claimNumber,
      providerName: c.provider?.name ?? 'Unknown',
      patientName: c.patient ? `${c.patient.firstName} ${c.patient.lastName}`.trim() : c.memberName,
      patientNumber: c.patient?.patientNumber ?? null,
      memberNumber: c.memberNumber,
      serviceDate: c.serviceDate.toISOString(),
      claimedAmount: s(c.claimedAmount),
      approvedAmount: c.approvedAmount != null ? s(c.approvedAmount) : null,
      paidAmount: s(c.paidAmount),
      outstanding: this.outstanding(c).toString(),
      status: c.status,
      batchNumber: c.batch?.batchNumber ?? null,
      submittedAt: c.submittedAt ? c.submittedAt.toISOString() : null,
    };
  }

  async getClaim(actor: Actor, id: string) {
    assertCan(actor.role, 'claims:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const c = await tx.insuranceClaim.findFirst({
        where: { id },
        include: {
          provider: { select: { id: true, name: true } },
          patient: { select: { id: true, firstName: true, lastName: true, patientNumber: true } },
          invoice: { select: { invoiceNumber: true } },
          batch: { select: { batchNumber: true } },
          lines: { orderBy: { description: 'asc' } },
          allocations: {
            include: { remittance: { select: { remittanceNumber: true, receivedAt: true, reversedAt: true } } },
          },
        },
      });
      if (!c) throw new NotFoundException('Claim not found');
      const nm = await this.names(tx, [c.createdById]);

      return {
        id: c.id,
        claimNumber: c.claimNumber,
        status: c.status,
        providerId: c.providerId,
        providerName: c.provider.name,
        patient: c.patient
          ? {
              id: c.patient.id,
              name: `${c.patient.firstName} ${c.patient.lastName}`.trim(),
              patientNumber: c.patient.patientNumber,
            }
          : null,
        visitId: c.visitId,
        invoiceId: c.invoiceId,
        invoiceNumber: c.invoice?.invoiceNumber ?? null,
        batchId: c.batchId,
        batchNumber: c.batch?.batchNumber ?? null,
        memberName: c.memberName,
        memberNumber: c.memberNumber,
        authCode: c.authCode,
        serviceDate: c.serviceDate.toISOString(),
        diagnosisCode: c.diagnosisCode,
        diagnosisSummary: c.diagnosisSummary,
        claimedAmount: s(c.claimedAmount),
        approvedAmount: c.approvedAmount != null ? s(c.approvedAmount) : null,
        paidAmount: s(c.paidAmount),
        patientResponsibility: s(c.patientResponsibility),
        writeOffAmount: s(c.writeOffAmount),
        outstanding: this.outstanding(c).toString(),
        rejectionReason: c.rejectionReason,
        notes: c.notes,
        submittedAt: c.submittedAt ? c.submittedAt.toISOString() : null,
        createdByName: c.createdById ? nm.get(c.createdById) ?? null : null,
        createdAt: c.createdAt.toISOString(),
        lines: c.lines.map((l: any) => ({
          id: l.id,
          invoiceLineId: l.invoiceLineId,
          serviceCode: l.serviceCode,
          description: l.description,
          diagnosisCode: l.diagnosisCode,
          quantity: l.quantity,
          unitPrice: s(l.unitPrice),
          claimedAmount: s(l.claimedAmount),
          approvedAmount: l.approvedAmount != null ? s(l.approvedAmount) : null,
          rejectionCode: l.rejectionCode,
          covered: l.covered,
        })),
        history: c.allocations
          .map((a: any) => ({
            id: a.id,
            remittanceNumber: a.remittance.remittanceNumber,
            receivedAt: a.remittance.receivedAt.toISOString(),
            approvedAmount: s(a.approvedAmount),
            paidAmount: s(a.paidAmount),
            shortfall: s(a.shortfall),
            shortfallAction: a.shortfallAction,
            reversed: !!a.remittance.reversedAt,
          }))
          .sort((x: any, y: any) => (x.receivedAt < y.receivedAt ? 1 : -1)),
      };
    });
  }

  // ─────────────────────────── claim generation ───────────────────────────

  async eligibleVisits(actor: Actor, q: EligibleVisitsQueryDto) {
    assertCan(actor.role, 'claims:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const where: Prisma.VisitWhereInput = {
        status: 'COMPLETED',
        payerType: { in: ['HMO', 'NHIS', 'RETAINER'] },
        invoice: { is: { status: { not: 'CANCELLED' }, claim: { is: null } } },
      };
      if (q.providerId) where.insuranceProviderId = q.providerId;
      if (q.from || q.to) {
        where.startsAt = {};
        if (q.from) (where.startsAt as any).gte = new Date(q.from);
        if (q.to) (where.startsAt as any).lte = new Date(`${q.to}T23:59:59`);
      }

      const visits = await tx.visit.findMany({
        where,
        include: {
          patient: { select: { firstName: true, lastName: true, patientNumber: true } },
          insuranceProvider: { select: { id: true, name: true } },
          invoice: { select: { id: true, totalAmount: true } },
        },
        orderBy: { startsAt: 'desc' },
        take: 200,
      });

      return visits
        .filter((v) => v.invoice)
        .map((v) => ({
          visitId: v.id,
          invoiceId: v.invoice!.id,
          patientName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
          patientNumber: v.patient.patientNumber,
          providerId: v.insuranceProvider?.id ?? null,
          providerName: v.insuranceProvider?.name ?? v.hmoName ?? null,
          serviceDate: v.startsAt.toISOString(),
          invoiceTotal: s(v.invoice!.totalAmount),
        }));
    });
  }

  async generate(actor: Actor, dto: GenerateClaimsDto) {
    assertCan(actor.role, 'claims:manage');
    const created: string[] = [];
    const skipped: { visitId: string; reason: string }[] = [];

    await this.prisma.forTenant(actor.tenantId, async (tx) => {
      for (const visitId of dto.visitIds) {
        const visit = await tx.visit.findFirst({
          where: { id: visitId },
          include: {
            patient: true,
            insuranceProvider: { select: { id: true, defaultCoPayPct: true } },
            invoice: { include: { lines: true } },
          },
        });
        if (!visit) {
          skipped.push({ visitId, reason: 'Visit not found' });
          continue;
        }
        if (!visit.invoice) {
          skipped.push({ visitId, reason: 'Visit has no invoice' });
          continue;
        }
        const existing = await tx.insuranceClaim.findFirst({
          where: { invoiceId: visit.invoice.id, status: { not: 'CANCELLED' } },
        });
        if (existing) {
          skipped.push({ visitId, reason: 'A claim already exists for this visit' });
          continue;
        }

        // resolve the provider
        let providerId = visit.insuranceProviderId ?? visit.patient.insuranceProviderId ?? null;
        let coPayPct = visit.insuranceProvider?.defaultCoPayPct ?? null;
        if (!providerId) {
          const nameGuess = visit.hmoName ?? visit.patient.hmoName ?? visit.patient.insuranceProvider;
          if (nameGuess) {
            const match = await tx.insuranceProvider.findFirst({
              where: { name: { equals: nameGuess, mode: 'insensitive' }, isActive: true },
              select: { id: true, defaultCoPayPct: true },
            });
            if (match) {
              providerId = match.id;
              coPayPct = match.defaultCoPayPct;
            }
          }
        }
        if (!providerId) {
          skipped.push({ visitId, reason: 'No insurance provider linked to the visit' });
          continue;
        }

        const factor = dec(1).sub(dec(coPayPct ?? 0).div(100));
        const billable = visit.invoice.lines.filter((l) => l.lineTotal.gt(0));
        if (!billable.length) {
          skipped.push({ visitId, reason: 'Invoice has no billable lines' });
          continue;
        }
        const lines = billable.map((l) => ({
          invoiceLineId: l.id,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          claimedAmount: round2(l.lineTotal.mul(factor)),
          covered: true,
        }));
        const claimed = lines.reduce((a, l) => a.add(l.claimedAmount), D0());
        const gross = billable.reduce((a, l) => a.add(l.lineTotal), D0());

        const claimNumber = await this.nextSeq(tx, 'insuranceClaim', actor.tenantId, 'CLM');
        const dx = await tx.diagnosis.findMany({
          where: { visitId: visit.id },
          select: { code: true, description: true },
        });
        const claim = await tx.insuranceClaim.create({
          data: {
            tenantId: actor.tenantId,
            claimNumber,
            providerId,
            patientId: visit.patientId,
            visitId: visit.id,
            invoiceId: visit.invoice.id,
            memberName: `${visit.patient.firstName} ${visit.patient.lastName}`.trim(),
            memberNumber: visit.patient.hmoNumber ?? visit.patient.insuranceNumber ?? '',
            authCode: visit.authCode,
            serviceDate: visit.startsAt,
            diagnosisCode: dx.find((d) => d.code)?.code ?? null,
            diagnosisSummary: dx.map((d) => d.description).join('; ') || null,
            claimedAmount: claimed,
            patientResponsibility: round2(gross.sub(claimed)),
            createdById: actor.userId,
            lines: {
              create: lines.map((l) => ({
                tenantId: actor.tenantId,
                invoiceLineId: l.invoiceLineId,
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                claimedAmount: l.claimedAmount,
                covered: l.covered,
              })),
            },
          },
        });
        await this.audit.record({
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'CREATE',
          entityType: 'InsuranceClaim',
          entityId: claim.id,
          metadata: { claimNumber, source: 'generate', visitId },
        });
        created.push(claim.id);
      }
    });

    return { created, skipped };
  }

  async createManual(actor: Actor, dto: CreateClaimDto) {
    assertCan(actor.role, 'claims:manage');
    if (!dto.lines.length) throw new BadRequestException('A claim needs at least one line');
    const id = await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const provider = await tx.insuranceProvider.findFirst({ where: { id: dto.providerId } });
      if (!provider) throw new BadRequestException('Unknown insurance provider');
      const claimed = dto.lines
        .filter((l) => l.covered !== false)
        .reduce((a, l) => a.add(dec(l.claimedAmount)), D0());
      const claimNumber = await this.nextSeq(tx, 'insuranceClaim', actor.tenantId, 'CLM');
      const claim = await tx.insuranceClaim.create({
        data: {
          tenantId: actor.tenantId,
          claimNumber,
          providerId: dto.providerId,
          patientId: dto.patientId,
          visitId: dto.visitId ?? null,
          invoiceId: dto.invoiceId ?? null,
          memberName: dto.memberName,
          memberNumber: dto.memberNumber,
          authCode: dto.authCode,
          serviceDate: new Date(dto.serviceDate),
          diagnosisCode: dto.diagnosisCode,
          diagnosisSummary: dto.diagnosisSummary,
          claimedAmount: claimed,
          createdById: actor.userId,
          lines: { create: dto.lines.map((l) => this.lineData(actor.tenantId, l)) },
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'InsuranceClaim',
        entityId: claim.id,
        metadata: { claimNumber, source: 'manual' },
      });
      return claim.id;
    });
    return this.getClaim(actor, id);
  }

  private lineData(tenantId: string, l: ClaimLineDto) {
    return {
      tenantId,
      invoiceLineId: l.invoiceLineId ?? null,
      serviceCode: l.serviceCode ?? null,
      description: l.description,
      diagnosisCode: l.diagnosisCode ?? null,
      quantity: l.quantity,
      unitPrice: dec(l.unitPrice),
      claimedAmount: dec(l.claimedAmount),
      covered: l.covered ?? true,
    };
  }

  async updateClaim(actor: Actor, id: string, dto: UpdateClaimDto) {
    assertCan(actor.role, 'claims:manage');
    await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const claim = await tx.insuranceClaim.findFirst({ where: { id } });
      if (!claim) throw new NotFoundException('Claim not found');
      if (claim.status !== 'DRAFT') throw new BadRequestException('Only a draft claim can be edited');

      const data: Prisma.InsuranceClaimUpdateInput = {
        memberName: dto.memberName ?? undefined,
        memberNumber: dto.memberNumber ?? undefined,
        authCode: dto.authCode !== undefined ? dto.authCode || null : undefined,
        serviceDate: dto.serviceDate ? new Date(dto.serviceDate) : undefined,
        diagnosisCode: dto.diagnosisCode !== undefined ? dto.diagnosisCode || null : undefined,
        diagnosisSummary: dto.diagnosisSummary !== undefined ? dto.diagnosisSummary || null : undefined,
        notes: dto.notes !== undefined ? dto.notes || null : undefined,
      };

      if (dto.lines) {
        if (!dto.lines.length) throw new BadRequestException('A claim needs at least one line');
        await tx.insuranceClaimLine.deleteMany({ where: { claimId: id } });
        await tx.insuranceClaimLine.createMany({
          data: dto.lines.map((l) => ({ claimId: id, ...this.lineData(actor.tenantId, l) })),
        });
        data.claimedAmount = dto.lines
          .filter((l) => l.covered !== false)
          .reduce((a, l) => a.add(dec(l.claimedAmount)), D0());
      }

      await tx.insuranceClaim.update({ where: { id }, data });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'UPDATE',
        entityType: 'InsuranceClaim',
        entityId: id,
      });
    });
    return this.getClaim(actor, id);
  }

  async submitClaim(actor: Actor, id: string, dto: SubmitClaimDto) {
    assertCan(actor.role, 'claims:manage');
    await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const claim = await tx.insuranceClaim.findFirst({ where: { id } });
      if (!claim) throw new NotFoundException('Claim not found');
      if (claim.status !== 'DRAFT') throw new BadRequestException('This claim is not a draft');

      let batchId: string | null = null;
      if (dto.batchId) {
        const batch = await tx.claimBatch.findFirst({ where: { id: dto.batchId } });
        if (!batch) throw new BadRequestException('Unknown batch');
        if (batch.status !== 'OPEN') throw new BadRequestException('That batch is not open');
        if (batch.providerId !== claim.providerId) {
          throw new BadRequestException('The batch is for a different provider');
        }
        batchId = batch.id;
      }

      await tx.insuranceClaim.update({
        where: { id },
        data: { status: 'SUBMITTED', submittedAt: new Date(), batchId: batchId ?? undefined },
      });
      if (batchId) await this.recomputeBatch(tx, batchId);
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'SUBMIT',
        entityType: 'InsuranceClaim',
        entityId: id,
        metadata: { batchId },
      });
    });
    return this.getClaim(actor, id);
  }

  async writeOffClaim(actor: Actor, id: string, dto: ReasonDto) {
    assertCan(actor.role, 'claims:manage');
    await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const claim = await tx.insuranceClaim.findFirst({ where: { id } });
      if (!claim) throw new NotFoundException('Claim not found');
      if (['PAID', 'WRITTEN_OFF', 'CANCELLED'].includes(claim.status)) {
        throw new BadRequestException('This claim is already closed');
      }
      const out = this.outstanding(claim);
      if (out.gt(0) && claim.invoiceId) {
        await this.postAdjustment(tx, actor.tenantId, claim.invoiceId, out.negated(), `HMO shortfall write-off: ${dto.reason}`, actor.userId);
      }
      await tx.insuranceClaim.update({
        where: { id },
        data: {
          status: 'WRITTEN_OFF',
          writeOffAmount: claim.writeOffAmount.add(out),
          closedAt: new Date(),
          notes: claim.notes ? `${claim.notes}\nWrite-off: ${dto.reason}` : `Write-off: ${dto.reason}`,
        },
      });
      if (claim.batchId) await this.recomputeBatch(tx, claim.batchId);
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'WRITE_OFF',
        entityType: 'InsuranceClaim',
        entityId: id,
        metadata: { amount: out.toString(), reason: dto.reason },
      });
    });
    return this.getClaim(actor, id);
  }

  async cancelClaim(actor: Actor, id: string, dto: ReasonDto) {
    assertCan(actor.role, 'claims:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const claim = await tx.insuranceClaim.findFirst({ where: { id } });
      if (!claim) throw new NotFoundException('Claim not found');
      if (!['DRAFT', 'SUBMITTED'].includes(claim.status)) {
        throw new BadRequestException('Only a draft or submitted claim can be cancelled');
      }
      await tx.insuranceClaim.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          closedAt: new Date(),
          batchId: null,
          invoiceId: null,
          visitId: null,
          notes: `Cancelled: ${dto.reason}`,
        },
      });
      if (claim.batchId) await this.recomputeBatch(tx, claim.batchId);
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'CANCEL',
        entityType: 'InsuranceClaim',
        entityId: id,
        metadata: { reason: dto.reason },
      });
      return { ok: true };
    });
  }

  // ─────────────────────────── batches ───────────────────────────

  async listBatches(actor: Actor, q: ListQueryDto) {
    assertCan(actor.role, 'claims:manage');
    const page = q.page && q.page > 0 ? q.page : 1;
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const where: Prisma.ClaimBatchWhereInput = {};
      if (q.providerId) where.providerId = q.providerId;
      if (q.status) where.status = q.status as any;
      const [total, rows] = await Promise.all([
        tx.claimBatch.count({ where }),
        tx.claimBatch.findMany({
          where,
          include: { provider: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);
      return { page, pageSize: PAGE_SIZE, total, rows: rows.map((b) => this.shapeBatch(b)) };
    });
  }

  private shapeBatch(b: any) {
    return {
      id: b.id,
      batchNumber: b.batchNumber,
      providerName: b.provider?.name ?? 'Unknown',
      periodStart: b.periodStart.toISOString(),
      periodEnd: b.periodEnd.toISOString(),
      status: b.status,
      claimCount: b.claimCount,
      claimedTotal: s(b.claimedTotal),
      approvedTotal: s(b.approvedTotal),
      paidTotal: s(b.paidTotal),
      submittedAt: b.submittedAt ? b.submittedAt.toISOString() : null,
      submissionRef: b.submissionRef,
    };
  }

  async getBatch(actor: Actor, id: string) {
    assertCan(actor.role, 'claims:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const b = await tx.claimBatch.findFirst({
        where: { id },
        include: {
          provider: { select: { id: true, name: true } },
          claims: {
            include: {
              provider: { select: { name: true } },
              patient: { select: { firstName: true, lastName: true, patientNumber: true } },
              batch: { select: { batchNumber: true } },
            },
            orderBy: { claimNumber: 'asc' },
          },
        },
      });
      if (!b) throw new NotFoundException('Batch not found');
      return {
        ...this.shapeBatch(b),
        providerId: b.providerId,
        notes: b.notes,
        claims: b.claims.map((c) => this.shapeListItem(c)),
      };
    });
  }

  async createBatch(actor: Actor, dto: CreateBatchDto) {
    assertCan(actor.role, 'claims:manage');
    const batchId = await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const provider = await tx.insuranceProvider.findFirst({ where: { id: dto.providerId } });
      if (!provider) throw new BadRequestException('Unknown insurance provider');
      const start = new Date(dto.periodStart);
      const end = new Date(`${dto.periodEnd}T23:59:59`);

      const batchNumber = await this.nextSeq(tx, 'claimBatch', actor.tenantId, 'BATCH');
      const batch = await tx.claimBatch.create({
        data: {
          tenantId: actor.tenantId,
          batchNumber,
          providerId: dto.providerId,
          periodStart: start,
          periodEnd: end,
          notes: dto.notes,
          createdById: actor.userId,
        },
      });

      const claimWhere: Prisma.InsuranceClaimWhereInput = dto.claimIds?.length
        ? { id: { in: dto.claimIds }, providerId: dto.providerId, batchId: null, status: { in: ['DRAFT', 'SUBMITTED'] } }
        : {
            providerId: dto.providerId,
            batchId: null,
            status: 'SUBMITTED',
            serviceDate: { gte: start, lte: end },
          };
      await tx.insuranceClaim.updateMany({ where: claimWhere, data: { batchId: batch.id } });
      await this.recomputeBatch(tx, batch.id);
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'ClaimBatch',
        entityId: batch.id,
        metadata: { batchNumber },
      });
      return batch.id;
    });
    return this.getBatch(actor, batchId);
  }

  async batchClaims(actor: Actor, id: string, dto: BatchClaimsDto, attach: boolean) {
    assertCan(actor.role, 'claims:manage');
    await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const batch = await tx.claimBatch.findFirst({ where: { id } });
      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.status !== 'OPEN') throw new BadRequestException('The batch is not open');

      if (attach) {
        await tx.insuranceClaim.updateMany({
          where: { id: { in: dto.claimIds }, providerId: batch.providerId, batchId: null, status: { in: ['DRAFT', 'SUBMITTED'] } },
          data: { batchId: id },
        });
      } else {
        await tx.insuranceClaim.updateMany({
          where: { id: { in: dto.claimIds }, batchId: id },
          data: { batchId: null },
        });
      }
      await this.recomputeBatch(tx, id);
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId,
        action: attach ? 'BATCH_ADD' : 'BATCH_REMOVE', entityType: 'ClaimBatch', entityId: id,
        metadata: { claimIds: dto.claimIds },
      });
    });
    return this.getBatch(actor, id);
  }

  async submitBatch(actor: Actor, id: string, dto: SubmitBatchDto) {
    assertCan(actor.role, 'claims:manage');
    await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const batch = await tx.claimBatch.findFirst({ where: { id } });
      if (!batch) throw new NotFoundException('Batch not found');
      if (batch.status !== 'OPEN') throw new BadRequestException('The batch is not open');

      const now = new Date();
      await tx.insuranceClaim.updateMany({
        where: { batchId: id, status: 'DRAFT' },
        data: { status: 'SUBMITTED', submittedAt: now },
      });
      await tx.claimBatch.update({
        where: { id },
        data: { status: 'SUBMITTED', submittedAt: now, submissionRef: dto.submissionRef },
      });
      await this.recomputeBatch(tx, id);
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'SUBMIT',
        entityType: 'ClaimBatch', entityId: id, metadata: { submissionRef: dto.submissionRef },
      });
    });
    return this.getBatch(actor, id);
  }

  async closeBatch(actor: Actor, id: string) {
    assertCan(actor.role, 'claims:manage');
    await this.prisma.forTenant(actor.tenantId, async (tx) => {
      const batch = await tx.claimBatch.findFirst({ where: { id } });
      if (!batch) throw new NotFoundException('Batch not found');
      await tx.claimBatch.update({ where: { id }, data: { status: 'CLOSED' } });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'CLOSE',
        entityType: 'ClaimBatch', entityId: id,
      });
    });
    return this.getBatch(actor, id);
  }

  async batchCsv(actor: Actor, id: string): Promise<string> {
    assertCan(actor.role, 'claims:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const batch = await tx.claimBatch.findFirst({
        where: { id },
        include: {
          provider: { select: { name: true } },
          claims: {
            include: { patient: { select: { firstName: true, lastName: true, patientNumber: true } } },
            orderBy: { claimNumber: 'asc' },
          },
        },
      });
      if (!batch) throw new NotFoundException('Batch not found');

      const rows: string[][] = [
        [`Claim schedule ${batch.batchNumber}`, batch.provider.name, `${batch.claimCount} claims`, s(batch.claimedTotal)],
        ['Claim #', 'Patient', 'Patient #', 'Member #', 'Auth code', 'Service date', 'Diagnosis', 'Claimed amount'],
      ];
      for (const c of batch.claims) {
        rows.push([
          c.claimNumber,
          `${c.patient.firstName} ${c.patient.lastName}`.trim(),
          c.patient.patientNumber,
          c.memberNumber,
          c.authCode ?? '',
          c.serviceDate.toISOString().slice(0, 10),
          c.diagnosisCode ?? c.diagnosisSummary ?? '',
          s(c.claimedAmount),
        ]);
      }
      return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    });
  }

  // ─────────────────────────── remittances ───────────────────────────

  async listRemittances(actor: Actor, q: ListQueryDto) {
    assertCan(actor.role, 'claims:manage');
    const page = q.page && q.page > 0 ? q.page : 1;
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const where: Prisma.ClaimRemittanceWhereInput = {};
      if (q.providerId) where.providerId = q.providerId;
      const [total, rows] = await Promise.all([
        tx.claimRemittance.count({ where }),
        tx.claimRemittance.findMany({
          where,
          include: {
            provider: { select: { name: true } },
            _count: { select: { allocations: true } },
          },
          orderBy: { receivedAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);
      return {
        page,
        pageSize: PAGE_SIZE,
        total,
        rows: rows.map((r) => ({
          id: r.id,
          remittanceNumber: r.remittanceNumber,
          providerName: r.provider?.name ?? 'Unknown',
          batchNumber: null,
          receivedAmount: s(r.receivedAmount),
          allocatedAmount: s(r.allocatedAmount),
          reference: r.reference,
          receivedAt: r.receivedAt.toISOString(),
          reversedAt: r.reversedAt ? r.reversedAt.toISOString() : null,
          claimCount: r._count.allocations,
        })),
      };
    });
  }

  async getRemittance(actor: Actor, id: string) {
    assertCan(actor.role, 'claims:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const r = await tx.claimRemittance.findFirst({
        where: { id },
        include: {
          provider: { select: { id: true, name: true } },
          allocations: {
            include: {
              claim: {
                select: {
                  claimNumber: true,
                  memberName: true,
                  patient: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      });
      if (!r) throw new NotFoundException('Remittance not found');
      const nm = await this.names(tx, [r.recordedById]);
      return {
        id: r.id,
        remittanceNumber: r.remittanceNumber,
        providerId: r.providerId,
        providerName: r.provider.name,
        batchId: r.batchId,
        batchNumber: null,
        receivedAmount: s(r.receivedAmount),
        allocatedAmount: s(r.allocatedAmount),
        reference: r.reference,
        receivedAt: r.receivedAt.toISOString(),
        reversedAt: r.reversedAt ? r.reversedAt.toISOString() : null,
        reversalReason: r.reversalReason,
        notes: r.notes,
        recordedByName: r.recordedById ? nm.get(r.recordedById) ?? null : null,
        claimCount: r.allocations.length,
        allocations: r.allocations.map((a) => ({
          id: a.id,
          claimId: a.claimId,
          claimNumber: a.claim.claimNumber,
          patientName: a.claim.patient
            ? `${a.claim.patient.firstName} ${a.claim.patient.lastName}`.trim()
            : a.claim.memberName,
          approvedAmount: s(a.approvedAmount),
          paidAmount: s(a.paidAmount),
          shortfall: s(a.shortfall),
          shortfallAction: a.shortfallAction,
        })),
      };
    });
  }

  async openClaims(actor: Actor, q: OpenClaimsQueryDto) {
    assertCan(actor.role, 'claims:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const where: Prisma.InsuranceClaimWhereInput = {
        providerId: q.providerId,
        status: { in: ['SUBMITTED', 'PART_PAID'] },
      };
      if (q.batchId) where.batchId = q.batchId;
      const claims = await tx.insuranceClaim.findMany({
        where,
        include: { patient: { select: { firstName: true, lastName: true } } },
        orderBy: { serviceDate: 'asc' },
      });
      return claims.map((c) => ({
        id: c.id,
        claimNumber: c.claimNumber,
        patientName: c.patient ? `${c.patient.firstName} ${c.patient.lastName}`.trim() : c.memberName,
        memberNumber: c.memberNumber,
        serviceDate: c.serviceDate.toISOString(),
        claimedAmount: s(c.claimedAmount),
        alreadyPaid: s(c.paidAmount),
        status: c.status,
      }));
    });
  }

  async createRemittance(actor: Actor, dto: CreateRemittanceDto) {
    assertCan(actor.role, 'claims:manage');
    if (!dto.allocations.length) throw new BadRequestException('Add at least one claim allocation');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const provider = await tx.insuranceProvider.findFirst({ where: { id: dto.providerId } });
      if (!provider) throw new BadRequestException('Unknown insurance provider');

      const remittanceNumber = await this.nextSeq(tx, 'claimRemittance', actor.tenantId, 'RMT');
      const remittance = await tx.claimRemittance.create({
        data: {
          tenantId: actor.tenantId,
          remittanceNumber,
          providerId: dto.providerId,
          batchId: dto.batchId ?? null,
          receivedAmount: dec(dto.receivedAmount),
          reference: dto.reference,
          receivedAt: new Date(dto.receivedAt),
          notes: dto.notes,
          recordedById: actor.userId,
        },
      });

      let allocatedTotal = D0();
      const touchedBatches = new Set<string>();

      for (const a of dto.allocations) {
        const claim = await tx.insuranceClaim.findFirst({ where: { id: a.claimId, providerId: dto.providerId } });
        if (!claim) throw new BadRequestException(`Claim ${a.claimId} is not on this provider`);
        if (!['SUBMITTED', 'PART_PAID'].includes(claim.status)) {
          throw new BadRequestException(`Claim ${claim.claimNumber} is not open for remittance`);
        }

        const approved = dec(a.approvedAmount);
        const paid = dec(a.paidAmount);
        const shortfall = claim.claimedAmount.sub(approved).lt(0) ? D0() : claim.claimedAmount.sub(approved);
        let paymentId: string | null = null;

        if (paid.gt(0) && claim.invoiceId) {
          const payment = await tx.payment.create({
            data: {
              tenantId: actor.tenantId,
              invoiceId: claim.invoiceId,
              receiptNumber: await this.nextReceipt(tx, actor.tenantId),
              amount: paid,
              method: 'TRANSFER',
              payerType: 'HMO',
              payerName: provider.name,
              reference: dto.reference,
              note: `Remittance ${remittanceNumber}`,
              receivedById: actor.userId,
            },
          });
          await this.billing.recomputeInvoice(tx, claim.invoiceId);
          paymentId = payment.id;
        }

        const newPaid = claim.paidAmount.add(paid);
        let status: ClaimStatus;
        if (approved.lte(0)) status = ClaimStatus.REJECTED;
        else if (newPaid.gte(approved)) status = ClaimStatus.PAID;
        else status = ClaimStatus.PART_PAID;

        let writeOff = claim.writeOffAmount;
        let patientResp = claim.patientResponsibility;
        if (a.shortfallAction === 'WRITE_OFF' && shortfall.gt(0) && claim.invoiceId) {
          await this.postAdjustment(
            tx,
            actor.tenantId,
            claim.invoiceId,
            shortfall.negated(),
            `HMO shortfall write-off: ${remittanceNumber}`,
            actor.userId,
          );
          writeOff = writeOff.add(shortfall);
          if (status !== ClaimStatus.REJECTED) status = ClaimStatus.PAID;
        } else if (a.shortfallAction === 'BILL_PATIENT' && shortfall.gt(0)) {
          patientResp = patientResp.add(shortfall);
          if (status !== ClaimStatus.REJECTED) status = ClaimStatus.PAID;
        }

        await tx.insuranceClaim.update({
          where: { id: claim.id },
          data: {
            approvedAmount: approved,
            paidAmount: newPaid,
            writeOffAmount: writeOff,
            patientResponsibility: patientResp,
            status,
            adjudicatedAt: new Date(),
            closedAt: status === ClaimStatus.PAID || status === ClaimStatus.REJECTED ? new Date() : null,
            rejectionReason: status === ClaimStatus.REJECTED ? a.note ?? 'Rejected by provider' : null,
          },
        });
        await tx.claimRemittanceAllocation.create({
          data: {
            tenantId: actor.tenantId,
            remittanceId: remittance.id,
            claimId: claim.id,
            approvedAmount: approved,
            paidAmount: paid,
            shortfall,
            shortfallAction: a.shortfallAction ?? null,
            paymentId,
            note: a.note,
          },
        });
        allocatedTotal = allocatedTotal.add(paid);
        if (claim.batchId) touchedBatches.add(claim.batchId);
      }

      await tx.claimRemittance.update({
        where: { id: remittance.id },
        data: { allocatedAmount: allocatedTotal },
      });
      for (const b of touchedBatches) await this.recomputeBatch(tx, b);

      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'REMITTANCE',
        entityType: 'ClaimRemittance',
        entityId: remittance.id,
        metadata: { remittanceNumber, received: s(dec(dto.receivedAmount)), allocated: allocatedTotal.toString() },
      });

      return {
        id: remittance.id,
        remittanceNumber,
        receivedAmount: s(dec(dto.receivedAmount)),
        allocatedAmount: allocatedTotal.toString(),
        variance: dec(dto.receivedAmount).sub(allocatedTotal).toString(),
      };
    });
  }

  async reverseRemittance(actor: Actor, id: string, dto: ReasonDto) {
    assertCan(actor.role, 'claims:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const remittance = await tx.claimRemittance.findFirst({
        where: { id },
        include: { allocations: true },
      });
      if (!remittance) throw new NotFoundException('Remittance not found');
      if (remittance.reversedAt) throw new BadRequestException('This remittance is already reversed');

      const touchedBatches = new Set<string>();
      for (const a of remittance.allocations) {
        const claim = await tx.insuranceClaim.findFirst({ where: { id: a.claimId } });
        if (!claim) continue;

        if (a.paymentId) {
          await tx.payment.update({
            where: { id: a.paymentId },
            data: {
              reversedAt: new Date(),
              reversedById: actor.userId,
              reversalReason: `Remittance ${remittance.remittanceNumber} reversed: ${dto.reason}`,
            },
          });
          if (claim.invoiceId) await this.billing.recomputeInvoice(tx, claim.invoiceId);
        }
        if (a.shortfallAction === 'WRITE_OFF' && a.shortfall.gt(0) && claim.invoiceId) {
          await this.postAdjustment(
            tx,
            actor.tenantId,
            claim.invoiceId,
            a.shortfall,
            `Reversal of HMO write-off: ${remittance.remittanceNumber}`,
            actor.userId,
          );
        }

        const newPaid = claim.paidAmount.sub(a.paidAmount).lt(0) ? D0() : claim.paidAmount.sub(a.paidAmount);
        const newWriteOff =
          a.shortfallAction === 'WRITE_OFF'
            ? claim.writeOffAmount.sub(a.shortfall).lt(0)
              ? D0()
              : claim.writeOffAmount.sub(a.shortfall)
            : claim.writeOffAmount;
        const newResp =
          a.shortfallAction === 'BILL_PATIENT'
            ? claim.patientResponsibility.sub(a.shortfall).lt(0)
              ? D0()
              : claim.patientResponsibility.sub(a.shortfall)
            : claim.patientResponsibility;

        await tx.insuranceClaim.update({
          where: { id: claim.id },
          data: {
            status: 'SUBMITTED',
            approvedAmount: null,
            paidAmount: newPaid,
            writeOffAmount: newWriteOff,
            patientResponsibility: newResp,
            adjudicatedAt: null,
            closedAt: null,
            rejectionReason: null,
          },
        });
        if (claim.batchId) touchedBatches.add(claim.batchId);
      }

      await tx.claimRemittance.update({
        where: { id },
        data: { reversedAt: new Date(), reversalReason: dto.reason, allocatedAmount: D0() },
      });
      for (const b of touchedBatches) await this.recomputeBatch(tx, b);
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'REMITTANCE_REVERSED',
        entityType: 'ClaimRemittance',
        entityId: id,
        metadata: { reason: dto.reason },
      });
      return { ok: true };
    });
  }

  // ─────────────────────────── receivables ───────────────────────────

  private agingBuckets() {
    return { b0_30: D0(), b31_60: D0(), b61_90: D0(), b90p: D0() };
  }

  private addAging(buckets: ReturnType<ClaimsService['agingBuckets']>, since: Date, amount: Prisma.Decimal) {
    const days = (Date.now() - since.getTime()) / 86_400_000;
    if (days <= 30) buckets.b0_30 = buckets.b0_30.add(amount);
    else if (days <= 60) buckets.b31_60 = buckets.b31_60.add(amount);
    else if (days <= 90) buckets.b61_90 = buckets.b61_90.add(amount);
    else buckets.b90p = buckets.b90p.add(amount);
  }

  private serialiseAging(b: ReturnType<ClaimsService['agingBuckets']>) {
    return { b0_30: b.b0_30.toString(), b31_60: b.b31_60.toString(), b61_90: b.b61_90.toString(), b90p: b.b90p.toString() };
  }

  private async receivablesSummary(tx: Prisma.TransactionClient) {
    const claims = await tx.insuranceClaim.findMany({
      where: { status: { in: [...ACTIVE_RECEIVABLE, ClaimStatus.REJECTED] } },
      select: {
        status: true,
        claimedAmount: true,
        approvedAmount: true,
        paidAmount: true,
        writeOffAmount: true,
        submittedAt: true,
        createdAt: true,
      },
    });
    const aging = this.agingBuckets();
    let outstanding = D0();
    let approvedUnpaid = D0();
    let rejectedCount = 0;
    let claimCount = 0;
    for (const c of claims) {
      const out = this.outstanding(c);
      if (c.status === 'REJECTED') {
        rejectedCount++;
        continue;
      }
      claimCount++;
      outstanding = outstanding.add(out);
      this.addAging(aging, c.submittedAt ?? c.createdAt, out);
      if (c.approvedAmount != null) {
        const au = c.approvedAmount.sub(c.paidAmount);
        if (au.gt(0)) approvedUnpaid = approvedUnpaid.add(au);
      }
    }
    return {
      outstanding: outstanding.toString(),
      aging: this.serialiseAging(aging),
      approvedUnpaid: approvedUnpaid.toString(),
      rejectedCount,
      claimCount,
    };
  }

  async receivables(actor: Actor) {
    assertCan(actor.role, 'claims:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const claims = await tx.insuranceClaim.findMany({
        where: { status: { in: [...ACTIVE_RECEIVABLE, ClaimStatus.REJECTED] } },
        include: { provider: { select: { id: true, name: true } } },
      });

      const byProvider = new Map<
        string,
        {
          providerId: string;
          providerName: string;
          outstanding: Prisma.Decimal;
          aging: ReturnType<ClaimsService['agingBuckets']>;
          approvedUnpaid: Prisma.Decimal;
          rejectedAmount: Prisma.Decimal;
          claimCount: number;
        }
      >();
      const totals = {
        outstanding: D0(),
        aging: this.agingBuckets(),
        approvedUnpaid: D0(),
        rejectedAmount: D0(),
        claimCount: 0,
      };

      for (const c of claims) {
        let row = byProvider.get(c.providerId);
        if (!row) {
          row = {
            providerId: c.providerId,
            providerName: c.provider.name,
            outstanding: D0(),
            aging: this.agingBuckets(),
            approvedUnpaid: D0(),
            rejectedAmount: D0(),
            claimCount: 0,
          };
          byProvider.set(c.providerId, row);
        }
        const out = this.outstanding(c);
        if (c.status === 'REJECTED') {
          row.rejectedAmount = row.rejectedAmount.add(out);
          totals.rejectedAmount = totals.rejectedAmount.add(out);
          continue;
        }
        row.claimCount++;
        totals.claimCount++;
        row.outstanding = row.outstanding.add(out);
        totals.outstanding = totals.outstanding.add(out);
        this.addAging(row.aging, c.submittedAt ?? c.createdAt, out);
        this.addAging(totals.aging, c.submittedAt ?? c.createdAt, out);
        if (c.approvedAmount != null) {
          const au = c.approvedAmount.sub(c.paidAmount);
          if (au.gt(0)) {
            row.approvedUnpaid = row.approvedUnpaid.add(au);
            totals.approvedUnpaid = totals.approvedUnpaid.add(au);
          }
        }
      }

      return {
        rows: [...byProvider.values()]
          .sort((a, b) => b.outstanding.cmp(a.outstanding))
          .map((r) => ({
            providerId: r.providerId,
            providerName: r.providerName,
            outstanding: r.outstanding.toString(),
            aging: this.serialiseAging(r.aging),
            approvedUnpaid: r.approvedUnpaid.toString(),
            rejectedAmount: r.rejectedAmount.toString(),
            claimCount: r.claimCount,
          })),
        totals: {
          outstanding: totals.outstanding.toString(),
          aging: this.serialiseAging(totals.aging),
          approvedUnpaid: totals.approvedUnpaid.toString(),
          rejectedAmount: totals.rejectedAmount.toString(),
          claimCount: totals.claimCount,
        },
      };
    });
  }
}
