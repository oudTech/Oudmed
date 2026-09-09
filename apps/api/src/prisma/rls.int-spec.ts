import { PrismaClient } from '@prisma/client';
import { destroyTenant, makePatient, makeTenant, ownerPrisma } from '../../test/int-helpers';

/**
 * Proves row-level security is enforced at the database, not just by forTenant.
 * Runs against APP_DATABASE_URL (the NOSUPERUSER / NOBYPASSRLS role). If that is
 * not configured, the suite fails loudly rather than passing silently - RLS not
 * being exercised is exactly the risk this spec exists to catch.
 */
const APP_URL = process.env.APP_DATABASE_URL;

function forTenant<T>(client: PrismaClient, tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  return client.$transaction(async (tx) => {
    await (tx as any).$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

describe('Row-level security (integration)', () => {
  it('APP_DATABASE_URL must be set so RLS is actually exercised', () => {
    expect(APP_URL && APP_URL.includes('oudhealth_app')).toBeTruthy();
  });

  // Guard: skip the DB assertions (not the check above) when the role is absent.
  const maybe = APP_URL ? describe : describe.skip;

  maybe('with the non-superuser app role', () => {
    const app = new PrismaClient({ datasources: { db: { url: APP_URL } } });
    let tenantA: string;
    let tenantB: string;

    beforeAll(async () => {
      tenantA = (await makeTenant()).id;
      tenantB = (await makeTenant()).id;
      await makePatient(tenantA, { firstName: 'Alice' });
      await makePatient(tenantB, { firstName: 'Bob' });
    });

    afterAll(async () => {
      await destroyTenant(tenantA);
      await destroyTenant(tenantB);
      await app.$disconnect();
      await ownerPrisma.$disconnect();
    });

    it('forTenant scopes reads to that tenant', async () => {
      const a = await forTenant<any[]>(app, tenantA, (tx) => tx.patient.findMany());
      const b = await forTenant<any[]>(app, tenantB, (tx) => tx.patient.findMany());
      expect(a.map((p: any) => p.firstName)).toEqual(['Alice']);
      expect(b.map((p: any) => p.firstName)).toEqual(['Bob']);
    });

    it('a query with no tenant context returns nothing', async () => {
      const rows = await app.patient.findMany();
      expect(rows).toHaveLength(0);
    });

    it('cannot write a row for another tenant (WITH CHECK)', async () => {
      await expect(
        forTenant(app, tenantA, (tx) =>
          tx.patient.create({
            data: { tenantId: tenantB, patientNumber: 'PT-EVIL', firstName: 'Mallory', lastName: 'X' },
          }),
        ),
      ).rejects.toThrow();
    });

    it('child tables InvoiceLine and PrescriptionItem are RLS-scoped by their own tenantId', async () => {
      // build one invoice+line and one prescription+item for tenant A, via the owner
      const pA = await ownerPrisma.patient.create({
        data: { tenantId: tenantA, patientNumber: 'PT-RLS-1', firstName: 'Line', lastName: 'Owner' },
      });
      const inv = await ownerPrisma.invoice.create({
        data: {
          tenantId: tenantA, patientId: pA.id, invoiceNumber: 'INV-RLS-1',
          subtotal: 100, totalAmount: 100,
          lines: { create: [{ tenantId: tenantA, description: 'x', quantity: 1, unitPrice: 100, grossAmount: 100, lineTotal: 100 }] },
        },
      });
      const rx = await ownerPrisma.prescription.create({
        data: {
          tenantId: tenantA, patientId: pA.id, status: 'ACTIVE',
          items: { create: [{ tenantId: tenantA, drugName: 'x' }] },
        },
      });

      // no context: nothing
      expect(await app.invoiceLine.findMany()).toHaveLength(0);
      expect(await app.prescriptionItem.findMany()).toHaveLength(0);

      // tenant A context: visible
      const linesA = await forTenant<any[]>(app, tenantA, (tx) => tx.invoiceLine.findMany());
      const itemsA = await forTenant<any[]>(app, tenantA, (tx) => tx.prescriptionItem.findMany());
      expect(linesA.length).toBeGreaterThanOrEqual(1);
      expect(itemsA.length).toBeGreaterThanOrEqual(1);

      // tenant B context: nothing
      expect(await forTenant<any[]>(app, tenantB, (tx) => tx.invoiceLine.findMany())).toHaveLength(0);
      expect(await forTenant<any[]>(app, tenantB, (tx) => tx.prescriptionItem.findMany())).toHaveLength(0);

      await ownerPrisma.invoiceLine.deleteMany({ where: { tenantId: tenantA } });
      await ownerPrisma.prescriptionItem.deleteMany({ where: { tenantId: tenantA } });
      await ownerPrisma.invoice.delete({ where: { id: inv.id } });
      await ownerPrisma.prescription.delete({ where: { id: rx.id } });
      await ownerPrisma.patient.delete({ where: { id: pA.id } });
    });

    it('audit rows insert without context but are not readable across tenants', async () => {
      await app.$executeRaw`
        INSERT INTO "AuditLog" ("id","tenantId","action","entityType","createdAt")
        VALUES (gen_random_uuid(), ${tenantA}, 'TEST', 'Probe', now())
      `;
      const noContext = await app.auditLog.findMany();
      expect(noContext).toHaveLength(0);
      const scoped = await forTenant<any[]>(app, tenantA, (tx) => tx.auditLog.findMany());
      expect(scoped.length).toBeGreaterThanOrEqual(1);
      const otherTenant = await forTenant<any[]>(app, tenantB, (tx) => tx.auditLog.findMany());
      expect(otherTenant).toHaveLength(0);
    });
  });
});
