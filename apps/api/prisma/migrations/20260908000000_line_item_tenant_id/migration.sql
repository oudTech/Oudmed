-- Give the child tables InvoiceLine and PrescriptionItem their own tenantId, so
-- every tenant-scoped table is covered by row-level security with no exceptions.
-- The column is added nullable, backfilled from the parent row, then made NOT
-- NULL. InvoiceLine.invoice and PrescriptionItem.prescription both cascade on
-- delete, so no orphan rows exist and the backfill covers 100% of rows.

-- ── InvoiceLine ──
ALTER TABLE "InvoiceLine" ADD COLUMN "tenantId" TEXT;

UPDATE "InvoiceLine" il
   SET "tenantId" = i."tenantId"
  FROM "Invoice" i
 WHERE il."invoiceId" = i."id";

ALTER TABLE "InvoiceLine" ALTER COLUMN "tenantId" SET NOT NULL;

-- ── PrescriptionItem ──
ALTER TABLE "PrescriptionItem" ADD COLUMN "tenantId" TEXT;

UPDATE "PrescriptionItem" pi
   SET "tenantId" = p."tenantId"
  FROM "Prescription" p
 WHERE pi."prescriptionId" = p."id";

ALTER TABLE "PrescriptionItem" ALTER COLUMN "tenantId" SET NOT NULL;

-- ── Indexes ──
CREATE INDEX "InvoiceLine_tenantId_idx" ON "InvoiceLine"("tenantId");
CREATE INDEX "PrescriptionItem_tenantId_idx" ON "PrescriptionItem"("tenantId");

-- ── Foreign keys ──
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
