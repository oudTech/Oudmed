import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { InpatientChargeRule, ShortStayChargeMode, planBedCharges } from './bed-charges';

// Bare marker, not a real User id - InvoiceLine.createdById/providedById and
// AuditLog.userId are all nullable, unconstrained strings (no FK), so a
// system-posted charge can carry this instead of impersonating a staff
// member or requiring one to exist.
const SYSTEM_USER_ID = 'system';

type TenantSettings = { id: string; inpatientChargeRule: InpatientChargeRule; shortStayChargeMode: ShortStayChargeMode };
type AdmissionRow = { id: string; tenantId: string; patientId: string; admittedAt: Date };

/**
 * F1b: posts bed-day charges (docs/features/F1-inpatient-billing.md section 6).
 * The pure day-counting logic lives in bed-charges.ts so every worked example
 * in the design doc is unit-tested directly; this service is only the
 * DB-aware wrapper - idempotency (BedDayCharge), ward/rate resolution
 * (AdmissionWardStay), and actually posting the charge via BillingService.
 */
@Injectable()
export class BedChargesService {
  private readonly log = new Logger(BedChargesService.name);

  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
  ) {}

  // 00:05 Africa/Lagos, just after midnight census - an explicit timeZone
  // rather than a UTC-offset cron string, so this is correct regardless of
  // the server's own deployment timezone (PROD-4: never assume the process
  // runs in UTC).
  @Cron('5 0 * * *', { timeZone: 'Africa/Lagos' })
  async postNightlyBedCharges(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, inpatientChargeRule: true, shortStayChargeMode: true },
    });
    const now = new Date();
    for (const tenant of tenants) {
      const admissions = await this.prisma.forTenant(tenant.id, (tx) =>
        tx.admission.findMany({
          where: { status: 'ADMITTED' },
          select: { id: true, tenantId: true, patientId: true, admittedAt: true },
        }),
      );
      for (const admission of admissions) {
        await this.prisma
          .forTenant(tenant.id, (tx) => this.postBedCharges(tx, admission, tenant, now, false))
          .catch((err) =>
            this.log.error(`nightly bed charge failed for admission ${admission.id}: ${(err as Error)?.message}`),
          );
      }
    }
  }

  /**
   * Posts every not-yet-charged bed-day/short-stay charge for one admission,
   * up to `through`. Called by the nightly cron (isFinal=false, through=now)
   * and by AdmissionsService.discharge() (isFinal=true, through=dischargedAt,
   * BEFORE the admission's ward-stay rows are closed, so "which ward was
   * open at this exact census instant" resolves correctly for the very last
   * one). Silently leaves a unit un-posted (no BedDayCharge row) when the
   * relevant ward rate is missing - the next call (another cron run, or this
   * same discharge reconciliation) retries it at whatever rate is current
   * then, so a hold never loses or doubles a charge.
   */
  async postBedCharges(
    tx: Prisma.TransactionClient,
    admission: AdmissionRow,
    tenant: TenantSettings,
    through: Date,
    isFinal: boolean,
  ): Promise<void> {
    const plan = planBedCharges({
      rule: tenant.inpatientChargeRule,
      admittedAt: admission.admittedAt,
      through,
      isFinal,
    });
    const already = new Set(
      (await tx.bedDayCharge.findMany({ where: { admissionId: admission.id }, select: { nightOf: true } })).map(
        (r) => r.nightOf.getTime(),
      ),
    );

    for (const unit of plan.units) {
      if (already.has(unit.nightOf.getTime())) continue;
      await this.postOneNight(tx, admission, unit.nightOf, unit.censusAt);
    }

    if (isFinal && plan.shortStay && !already.has(admission.admittedAt.getTime())) {
      await this.postShortStayCharge(tx, admission, tenant);
    }
  }

  private async wardStayAt(tx: Prisma.TransactionClient, admissionId: string, censusAt: Date) {
    return tx.admissionWardStay.findFirst({
      where: {
        admissionId,
        startedAt: { lte: censusAt },
        OR: [{ endedAt: null }, { endedAt: { gt: censusAt } }],
      },
      include: { ward: { select: { name: true, dailyRate: true, dayCaseRate: true } } },
    });
  }

  private async postOneNight(tx: Prisma.TransactionClient, admission: AdmissionRow, nightOf: Date, censusAt: Date) {
    const stay = await this.wardStayAt(tx, admission.id, censusAt);
    if (!stay || !stay.ward.dailyRate) return; // held - no marker written, retried on the next call
    const { lineId } = await this.billing.postCharge(tx, {
      tenantId: admission.tenantId,
      userId: SYSTEM_USER_ID,
      admissionId: admission.id,
      patientId: admission.patientId,
      description: `Ward stay - ${stay.ward.name} - ${nightOf.toISOString().slice(0, 10)}`,
      quantity: 1,
      unitPrice: stay.ward.dailyRate,
      category: 'Inpatient',
    });
    await tx.bedDayCharge.create({
      data: { tenantId: admission.tenantId, admissionId: admission.id, nightOf, invoiceLineId: lineId },
    });
  }

  private async postShortStayCharge(tx: Prisma.TransactionClient, admission: AdmissionRow, tenant: TenantSettings) {
    const nightOf = admission.admittedAt; // one canonical marker, unique per admission
    if (tenant.shortStayChargeMode === 'NONE') {
      await tx.bedDayCharge.create({
        data: { tenantId: admission.tenantId, admissionId: admission.id, nightOf, invoiceLineId: null },
      });
      return;
    }
    // Still admitted (open ward-stay row) at the instant this runs, since
    // discharge calls this before closing the row - the current ward is the
    // only one a same-day stay could ever have had.
    const stay = await tx.admissionWardStay.findFirst({
      where: { admissionId: admission.id, endedAt: null },
      include: { ward: { select: { name: true, dailyRate: true, dayCaseRate: true } } },
    });
    if (!stay) return;
    const rate = tenant.shortStayChargeMode === 'DAY_CASE_RATE' ? stay.ward.dayCaseRate : stay.ward.dailyRate;
    if (!rate) return; // held - a later discharge-side fix-up is the only retry path for an already-discharged admission
    const { lineId } = await this.billing.postCharge(tx, {
      tenantId: admission.tenantId,
      userId: SYSTEM_USER_ID,
      admissionId: admission.id,
      patientId: admission.patientId,
      description: `Ward stay (day case) - ${stay.ward.name}`,
      quantity: 1,
      unitPrice: rate,
      category: 'Inpatient',
    });
    await tx.bedDayCharge.create({
      data: { tenantId: admission.tenantId, admissionId: admission.id, nightOf, invoiceLineId: lineId },
    });
  }
}
