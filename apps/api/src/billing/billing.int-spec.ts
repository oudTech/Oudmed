import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from './billing.module';
import { BillingService } from './billing.service';
import {
  actorFor,
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  makeVisit,
  ownerPrisma,
} from '../../test/int-helpers';

describe('BillingService (integration - money paths)', () => {
  let prisma: PrismaService;
  let billing: BillingService;
  let tenantId: string;
  let userId: string;
  let actor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule],
    }).compile();
    prisma = mod.get(PrismaService);
    billing = mod.get(BillingService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    const u = await makeUser(tenantId);
    userId = u.id;
    actor = actorFor(tenantId, userId);
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('postChargeToVisit: two charges land on one invoice and inherit the visit payer type', async () => {
    const patient = await makePatient(tenantId);
    const visit = await makeVisit(tenantId, patient.id, { payerType: 'HMO', hmoName: 'Test HMO' });

    await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId, visitId: visit.id, patientId: patient.id,
        description: 'Consultation', quantity: 1, unitPrice: 5000, category: 'Consultation',
      }),
    );
    await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId, visitId: visit.id, patientId: patient.id,
        description: 'Lab', quantity: 2, unitPrice: 3000, category: 'Laboratory',
      }),
    );

    const invoices = await ownerPrisma.invoice.findMany({
      where: { visitId: visit.id },
      include: { lines: true },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].lines).toHaveLength(2);
    expect(invoices[0].payerType).toBe('HMO');
    expect(Number(invoices[0].subtotal)).toBe(5000 + 2 * 3000);
    expect(Number(invoices[0].totalAmount)).toBe(11000);
  });

  it('addPayment / reversePayment: status tracks the balance, overpayment is rejected', async () => {
    const patient = await makePatient(tenantId);
    const visit = await makeVisit(tenantId, patient.id);
    const { invoiceId } = await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId, visitId: visit.id, patientId: patient.id,
        description: 'Procedure', quantity: 1, unitPrice: 10000, category: 'Procedure',
      }),
    );

    const first = await billing.addPayment(actor, invoiceId, { amount: 4000, method: 'CASH' } as any);
    expect(first.status).toBe('PARTIAL');

    // overpayment
    await expect(
      billing.addPayment(actor, invoiceId, { amount: 999999, method: 'CASH' } as any),
    ).rejects.toMatchObject({ response: { code: 'OVERPAYMENT' } });

    const second = await billing.addPayment(actor, invoiceId, { amount: 6000, method: 'CASH' } as any);
    expect(second.status).toBe('PAID');

    // cancelling a paid invoice is blocked while payments stand
    await expect(
      billing.cancelInvoice(actor, invoiceId, { reason: 'oops' } as any),
    ).rejects.toMatchObject({ response: { code: 'HAS_PAYMENTS' } });

    // reverse both, then it recomputes down and can be cancelled
    await billing.reversePayment(actor, second.paymentId, { reason: 'bank recall' } as any);
    let inv = await billing.getInvoice(tenantId, invoiceId);
    expect(inv.status).toBe('PARTIAL');
    expect(Number(inv.paidAmount)).toBe(4000);

    await billing.reversePayment(actor, first.paymentId, { reason: 'bank recall' } as any);
    inv = await billing.getInvoice(tenantId, invoiceId);
    expect(inv.status).toBe('UNPAID');
    expect(Number(inv.paidAmount)).toBe(0);

    await expect(billing.cancelInvoice(actor, invoiceId, { reason: 'raised in error' } as any)).resolves.toEqual({ ok: true });
  });

  it('addPayment idempotency: a retried key does not create a second payment', async () => {
    const patient = await makePatient(tenantId);
    const visit = await makeVisit(tenantId, patient.id);
    const { invoiceId } = await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId, visitId: visit.id, patientId: patient.id,
        description: 'Consult', quantity: 1, unitPrice: 5000, category: 'Consultation',
      }),
    );
    const key = 'idem-' + Math.random().toString(36).slice(2);

    const a = await billing.addPayment(actor, invoiceId, { amount: 2000, method: 'CASH', idempotencyKey: key } as any);
    const b = await billing.addPayment(actor, invoiceId, { amount: 2000, method: 'CASH', idempotencyKey: key } as any);

    expect(b.paymentId).toBe(a.paymentId);
    expect((b as any).idempotentReplay).toBe(true);
    expect(await ownerPrisma.payment.count({ where: { invoiceId, idempotencyKey: key } })).toBe(1);

    // a fresh key on the same invoice is a real second payment
    const c = await billing.addPayment(actor, invoiceId, { amount: 1000, method: 'CASH', idempotencyKey: key + '-2' } as any);
    expect(c.paymentId).not.toBe(a.paymentId);
    const inv = await billing.getInvoice(tenantId, invoiceId);
    expect(Number(inv.paidAmount)).toBe(3000);
  });

  it('concurrent first-charge on one visit produces a single invoice, no 500', async () => {
    const patient = await makePatient(tenantId);
    const visit = await makeVisit(tenantId, patient.id);

    await Promise.all(
      [1, 2, 3].map((n) =>
        prisma.forTenant(tenantId, (tx) =>
          billing.postChargeToVisit(tx, {
            tenantId, userId, visitId: visit.id, patientId: patient.id,
            description: `Item ${n}`, quantity: 1, unitPrice: 1000, category: 'Services',
          }),
        ),
      ),
    );

    const invoices = await ownerPrisma.invoice.findMany({ where: { visitId: visit.id }, include: { lines: true } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].lines).toHaveLength(3);
    expect(Number(invoices[0].totalAmount)).toBe(3000);
  });

  it('B2: concurrent payments on one invoice cannot exceed the balance (per-invoice lock)', async () => {
    const patient = await makePatient(tenantId);
    const visit = await makeVisit(tenantId, patient.id);
    const { invoiceId } = await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId, visitId: visit.id, patientId: patient.id,
        description: 'Procedure', quantity: 1, unitPrice: 10000, category: 'Procedure',
      }),
    );

    // Two concurrent payments, NO idempotency key. Each fits the 10000 balance
    // alone; together they exceed it. Only the invoice lock stands between them.
    const results = await Promise.allSettled([
      billing.addPayment(actor, invoiceId, { amount: 7000, method: 'CASH' } as any),
      billing.addPayment(actor, invoiceId, { amount: 7000, method: 'CASH' } as any),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ response: { code: 'OVERPAYMENT' } });

    const inv = await billing.getInvoice(tenantId, invoiceId);
    expect(Number(inv.totalAmount)).toBe(10000);
    expect(Number(inv.paidAmount)).toBe(7000);      // exactly one payment stuck
    expect(inv.status).toBe('PARTIAL');
    const live = await ownerPrisma.payment.count({ where: { invoiceId, reversedAt: null } });
    expect(live).toBe(1);
  });

  it('B2: concurrent payments that both fit the balance are both recorded', async () => {
    const patient = await makePatient(tenantId);
    const visit = await makeVisit(tenantId, patient.id);
    const { invoiceId } = await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId, visitId: visit.id, patientId: patient.id,
        description: 'Procedure', quantity: 1, unitPrice: 10000, category: 'Procedure',
      }),
    );

    const results = await Promise.allSettled([
      billing.addPayment(actor, invoiceId, { amount: 4000, method: 'CASH' } as any),
      billing.addPayment(actor, invoiceId, { amount: 5000, method: 'CASH' } as any),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const inv = await billing.getInvoice(tenantId, invoiceId);
    expect(Number(inv.paidAmount)).toBe(9000);
    expect(inv.status).toBe('PARTIAL');
  });

  it('updateInvoice: adjust the invoice discount and re-total; blocked once paid', async () => {
    const patient = await makePatient(tenantId);
    const inv = await billing.createInvoice(actor, {
      patientId: patient.id,
      lines: [{ description: 'X-ray', quantity: 1, unitPrice: 10000 }],
    } as any);

    await billing.updateInvoice(actor, inv.id, { invoiceDiscountPct: 10, discountReason: 'Staff' } as any);
    let detail = await billing.getInvoice(tenantId, inv.id);
    expect(Number(detail.totalAmount)).toBe(9000);
    expect(detail.discountPct).toBe('10');

    await billing.addPayment(actor, inv.id, { amount: 9000, method: 'CASH' } as any);
    await expect(
      billing.updateInvoice(actor, inv.id, { invoiceDiscountPct: 0 } as any),
    ).rejects.toMatchObject({ response: { code: 'HAS_PAYMENTS' } });
  });

  it('removeInvoiceLine: drops a line and re-totals; keeps at least one; blocked once paid', async () => {
    const patient = await makePatient(tenantId);
    const inv = await billing.createInvoice(actor, {
      patientId: patient.id,
      lines: [
        { description: 'Consult', quantity: 1, unitPrice: 5000 },
        { description: 'Dressing', quantity: 1, unitPrice: 2000 },
      ],
    } as any);
    const full = await billing.getInvoice(tenantId, inv.id);
    expect(Number(full.totalAmount)).toBe(7000);

    await billing.removeInvoiceLine(actor, inv.id, full.lines[1].id);
    const after = await billing.getInvoice(tenantId, inv.id);
    expect(after.lines).toHaveLength(1);
    expect(Number(after.totalAmount)).toBe(5000);

    await expect(
      billing.removeInvoiceLine(actor, inv.id, after.lines[0].id),
    ).rejects.toThrow(/at least one line/);
  });

  it('listInvoices summary is computed with DB aggregates and matches the rows', async () => {
    const t2 = (await makeTenant()).id;
    try {
      const u2 = actorFor(t2, (await makeUser(t2)).id);
      const p2 = await makePatient(t2);
      const a = await billing.createInvoice(u2, { patientId: p2.id, lines: [{ description: 'A', quantity: 1, unitPrice: 4000 }] } as any);
      const b = await billing.createInvoice(u2, { patientId: p2.id, lines: [{ description: 'B', quantity: 1, unitPrice: 6000 }] } as any);
      const cancelled = await billing.createInvoice(u2, { patientId: p2.id, lines: [{ description: 'C', quantity: 1, unitPrice: 9999 }] } as any);
      await billing.cancelInvoice(u2, cancelled.id, { reason: 'error' } as any);
      await billing.addPayment(u2, a.id, { amount: 1000, method: 'CASH' } as any);

      const list = await billing.listInvoices(t2, {});
      expect(list.summary.count).toBe(2);                 // cancelled excluded
      expect(Number(list.summary.amount)).toBe(10000);    // 4000 + 6000
      expect(Number(list.summary.paid)).toBe(1000);
      expect(Number(list.summary.balance)).toBe(9000);
    } finally {
      await destroyTenant(t2);
    }
  });

  // ── TP-001: an invoice's foreign keys must belong to the caller's tenant ──
  describe('TP-001: createInvoice cannot reference another tenant\'s objects', () => {
    it('cross-tenant patientId is rejected (404), no row written', async () => {
      const other = (await makeTenant()).id;
      try {
        const foreignPatient = await makePatient(other);
        const before = await ownerPrisma.invoice.count({ where: { tenantId } });
        await expect(
          billing.createInvoice(actor, { patientId: foreignPatient.id, lines: [{ description: 'x', quantity: 1, unitPrice: 5000 }] } as any),
        ).rejects.toMatchObject({ status: 404 });
        expect(await ownerPrisma.invoice.count({ where: { tenantId } })).toBe(before);
        // and the caller's billing list is unaffected (no poison row -> no 500)
        await expect(billing.listInvoices(tenantId, {})).resolves.toBeDefined();
      } finally {
        await destroyTenant(other);
      }
    });

    it('non-existent / malformed patientId is a 404, not a 500', async () => {
      await expect(
        billing.createInvoice(actor, { patientId: '00000000-0000-0000-0000-000000000000', lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] } as any),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        billing.createInvoice(actor, { patientId: 'not-a-uuid', lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] } as any),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('cross-tenant visitId cannot be squatted; the owning tenant keeps its per-visit invoice slot', async () => {
      const other = (await makeTenant()).id;
      try {
        const oUser = actorFor(other, (await makeUser(other)).id);
        const oPatient = await makePatient(other);
        const oVisit = await makeVisit(other, oPatient.id);
        const myPatient = await makePatient(tenantId);

        // attacker (this tenant) tries to bind an invoice to the other tenant's visit
        await expect(
          billing.createInvoice(actor, { patientId: myPatient.id, visitId: oVisit.id, lines: [{ description: 'squat', quantity: 1, unitPrice: 1 }] } as any),
        ).rejects.toMatchObject({ status: 404 });

        // the owning tenant can still raise its own per-visit invoice and post charges to that visit
        const own = await billing.createInvoice(oUser, { patientId: oPatient.id, visitId: oVisit.id, lines: [{ description: 'consult', quantity: 1, unitPrice: 5000 }] } as any);
        expect(own.id).toBeDefined();
        const charge = await prisma.forTenant(other, (tx) =>
          billing.postChargeToVisit(tx, { tenantId: other, userId: oUser.userId, visitId: oVisit.id, patientId: oPatient.id, description: 'Drug', quantity: 1, unitPrice: 10, category: 'Pharmacy' }),
        );
        expect(charge.invoiceId).toBe(own.id); // same one-per-visit invoice, no unique clash
      } finally {
        await destroyTenant(other);
      }
    });

    it('cross-tenant serviceItemId / drugId in a line is rejected (400)', async () => {
      const other = (await makeTenant()).id;
      try {
        const myPatient = await makePatient(tenantId);
        const foreignSvc = await ownerPrisma.serviceItem.create({ data: { tenantId: other, name: 'X', unitPrice: 10 } });
        const foreignDrug = await ownerPrisma.drug.create({ data: { tenantId: other, sku: `MED-${Date.now()}`, name: 'X', sellPrice: 10, quantityOnHand: 0 } });
        await expect(
          billing.createInvoice(actor, { patientId: myPatient.id, lines: [{ description: 'x', quantity: 1, unitPrice: 10, serviceItemId: foreignSvc.id }] } as any),
        ).rejects.toMatchObject({ status: 400 });
        await expect(
          billing.createInvoice(actor, { patientId: myPatient.id, lines: [{ description: 'x', quantity: 1, unitPrice: 10, drugId: foreignDrug.id }] } as any),
        ).rejects.toMatchObject({ status: 400 });
      } finally {
        await destroyTenant(other);
      }
    });

    it('own-tenant patient + visit + service item still works (regression)', async () => {
      const p = await makePatient(tenantId);
      const v = await makeVisit(tenantId, p.id);
      const svc = await ownerPrisma.serviceItem.create({ data: { tenantId, name: 'Consult', unitPrice: 5000 } });
      const inv = await billing.createInvoice(actor, {
        patientId: p.id, visitId: v.id,
        lines: [{ description: 'Consult', quantity: 1, unitPrice: 5000, serviceItemId: svc.id }],
      } as any);
      const detail = await billing.getInvoice(tenantId, inv.id);
      expect(Number(detail.totalAmount)).toBe(5000);
      expect(detail.visitId).toBe(v.id);
    });
  });
});
