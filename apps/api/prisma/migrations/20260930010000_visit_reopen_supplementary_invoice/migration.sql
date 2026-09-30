-- FUNC-2: visit reopen, completed-visit/paid-invoice guard, supplementary
-- invoices, and a late-entry addendum for the SOAP note.
--
-- Invoice.visitId loses its uniqueness: a visit can now have a second
-- ("supplementary") invoice when its original is locked by a live payment or
-- an existing claim and the visit is reopened for more billable activity -
-- see BillingService.postChargeToVisit. InsuranceClaim.invoiceId stays
-- unique (a claim still points to exactly one invoice; a supplementary
-- invoice can carry its own separate claim).

-- DropIndex
DROP INDEX "Invoice_visitId_key";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "isSupplementary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reopenAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "reopenAcknowledgedById" TEXT,
ADD COLUMN     "reopenFlaggedAt" TIMESTAMP(3),
ADD COLUMN     "supplementOfInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "reopenedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ClinicalNoteAddendum" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "subjective" TEXT,
    "objective" TEXT,
    "assessment" TEXT,
    "plan" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalNoteAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClinicalNoteAddendum_tenantId_idx" ON "ClinicalNoteAddendum"("tenantId");

-- CreateIndex
CREATE INDEX "ClinicalNoteAddendum_visitId_idx" ON "ClinicalNoteAddendum"("visitId");

-- CreateIndex
CREATE INDEX "Invoice_visitId_idx" ON "Invoice"("visitId");

-- AddForeignKey
ALTER TABLE "ClinicalNoteAddendum" ADD CONSTRAINT "ClinicalNoteAddendum_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNoteAddendum" ADD CONSTRAINT "ClinicalNoteAddendum_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNoteAddendum" ADD CONSTRAINT "ClinicalNoteAddendum_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplementOfInvoiceId_fkey" FOREIGN KEY ("supplementOfInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
