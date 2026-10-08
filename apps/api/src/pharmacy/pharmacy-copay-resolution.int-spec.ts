import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { AdmissionsModule } from '../admissions/admissions.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { ScheduleService } from '../schedule/schedule.service';
import { PharmacyModule } from './pharmacy.module';
import { PharmacyService } from './pharmacy.service';
import {
  actorFor,
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  ownerPrisma,
} from '../../test/int-helpers';

const day = (n: number) => new Date(Date.now() + n * 86_400_000);

/**
 * Fix 2 of the "HMO claims not reflecting" investigation (2026-10-08,
 * docs/audit/phase1-status.md), pharmacy side: PharmacyService.resolveCoPay
 * had the identical bug as ClaimsService.generate() - the same visit's
 * co-pay silently resolved to 0% for a visit created through the real
 * booking flow (makeVisit-fixture-based tests, like the existing
 * pay-before-dispense.int-spec.ts co-pay-split case, set
 * Visit.insuranceProviderId directly and never exercised this).
 */
describe('PharmacyService.prepare - co-pay resolution for a real booking-flow visit (integration)', () => {
  let prisma: PrismaService;
  let schedule: ScheduleService;
  let pharmacy: PharmacyService;
  let tenantId: string;
  let pharmacistActor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, AdmissionsModule, ScheduleModule, PharmacyModule],
    }).compile();
    prisma = mod.get(PrismaService);
    schedule = mod.get(ScheduleService);
    pharmacy = mod.get(PharmacyService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    await ownerPrisma.tenant.update({ where: { id: tenantId }, data: { requirePaymentBeforeDispense: true } });
    pharmacistActor = actorFor(tenantId, (await makeUser(tenantId, 'PHARMACIST')).id, 'PHARMACIST');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  async function makeDrug(sellPrice: number, qty: number) {
    const drug = await ownerPrisma.drug.create({
      data: { tenantId, sku: `MED-${Math.random().toString(36).slice(2, 8)}`, name: 'Test Drug', sellPrice, quantityOnHand: qty },
    });
    await ownerPrisma.drugBatch.create({
      data: { tenantId, drugId: drug.id, batchNumber: 'B1', expiryDate: day(180), quantity: qty },
    });
    return drug;
  }

  it('gates the real co-pay share, not the whole charge nor none of it, for a visit booked through the real flow', async () => {
    const provider = await ownerPrisma.insuranceProvider.create({
      data: { tenantId, name: 'Pharmacy Real Flow HMO', kind: 'HMO', defaultCoPayPct: 30 },
    });
    const patient = await makePatient(tenantId, { insuranceProviderId: provider.id, hmoName: 'Pharmacy Real Flow HMO' });
    const visit = await schedule.create(
      { tenantId, userId: pharmacistActor.userId, role: 'HOSPITAL_ADMIN' },
      { patientId: patient.id, startsAt: new Date().toISOString(), payerType: 'HMO' as any } as any,
    );
    expect(visit.insuranceProviderId).toBe(provider.id); // Fix 1 precondition

    const drug = await makeDrug(100, 10);
    const rx = await ownerPrisma.prescription.create({
      data: {
        tenantId, patientId: patient.id, visitId: visit.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
        items: { create: [{ tenantId, drugId: drug.id, drugName: 'Test Drug' }] },
      },
      include: { items: true },
    });
    const item = rx.items[0];

    // 30% co-pay -> 70% covered: round(10*0.7) = 7 covered immediately, 3 gated.
    // Before the fix this resolved to 0% co-pay: all 10 would dispense
    // immediately with nothing gated, silently skipping the patient's share.
    const prepared = await pharmacy.prepare(pharmacistActor, rx.id, { items: [{ itemId: item.id, quantity: 10 }] });
    const preparedItem = prepared.items.find((it: any) => it.id === item.id);
    expect(preparedItem).toBeDefined();
    expect(preparedItem!.dispensedQty).toBe(7);
    expect(preparedItem!.preparedQty).toBe(3);
  });
});
