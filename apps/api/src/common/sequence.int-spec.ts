import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from './audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { nextSequence } from './sequence';
import {
  actorFor,
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  makeVisit,
  ownerPrisma,
} from '../../test/int-helpers';

/**
 * NN2: per-tenant document numbers were `count(*) + 1`, which collides under
 * concurrency (duplicate-key 500) and is not gapless. These prove the
 * TenantSequence counter is race-free, gapless on rollback, and seeds from
 * existing data.
 */
describe('nextSequence (integration - gapless numbering)', () => {
  let prisma: PrismaService;
  let billing: BillingService;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule],
    }).compile();
    prisma = mod.get(PrismaService);
    billing = mod.get(BillingService);
    tenantId = (await makeTenant()).id;
    userId = (await makeUser(tenantId)).id;
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('hands out distinct consecutive values under concurrent transactions', async () => {
    const N = 12;
    const values = await Promise.all(
      Array.from({ length: N }, () =>
        prisma.forTenant(tenantId, (tx) => nextSequence(tx, tenantId, 'patient', async () => 0)),
      ),
    );
    values.sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it('does not consume a number when the transaction rolls back (gapless)', async () => {
    const before = await prisma.forTenant(tenantId, (tx) =>
      nextSequence(tx, tenantId, 'admission', async () => 0),
    );

    await expect(
      prisma.forTenant(tenantId, async (tx) => {
        await nextSequence(tx, tenantId, 'admission', async () => 0);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const after = await prisma.forTenant(tenantId, (tx) =>
      nextSequence(tx, tenantId, 'admission', async () => 0),
    );
    expect(after).toBe(before + 1); // the burned attempt did not advance the counter
  });

  it('seeds the counter from the existing row count on first use', async () => {
    const t2 = (await makeTenant()).id;
    try {
      // three pre-existing patients, created straight through the owner client
      for (let i = 1; i <= 3; i++) {
        await ownerPrisma.patient.create({
          data: { tenantId: t2, patientNumber: `PT-0000${i}`, firstName: 'Seed', lastName: `${i}` },
        });
      }
      const n = await prisma.forTenant(t2, (tx) =>
        nextSequence(tx, t2, 'patient', () => tx.patient.count({ where: { tenantId: t2 } })),
      );
      expect(n).toBe(4);
    } finally {
      await destroyTenant(t2);
    }
  });

  it('concurrent real invoice creation yields unique consecutive invoice numbers', async () => {
    const patient = await makePatient(tenantId);
    const N = 4;
    const visits = await Promise.all(
      Array.from({ length: N }, () => makeVisit(tenantId, patient.id)),
    );

    await Promise.all(
      visits.map((v) =>
        prisma.forTenant(tenantId, (tx) =>
          billing.postChargeToVisit(tx, {
            tenantId, userId, visitId: v.id, patientId: patient.id,
            description: 'Consult', quantity: 1, unitPrice: 1000, category: 'Consultation',
          }),
        ),
      ),
    );

    const invoices = await ownerPrisma.invoice.findMany({
      where: { tenantId, visitId: { in: visits.map((v) => v.id) } },
      select: { invoiceNumber: true },
    });
    const nums = invoices.map((i) => Number(i.invoiceNumber.split('-')[1])).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(N);
    expect(nums[N - 1] - nums[0]).toBe(N - 1); // strictly consecutive, no gaps
  });
});
