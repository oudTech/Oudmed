-- F1a: inpatient/admissions billing foundations.
--
-- Invoice/InsuranceClaim gain an optional admissionId alongside their
-- existing visitId, so an admission's running bill reuses the exact same
-- Invoice/InvoiceLine + supplementary-invoice-on-lock machinery visits
-- already have (FUNC-2) - see docs/features/F1-inpatient-billing.md.
--
-- Complaint and Prescription gain admissionId to match Diagnosis,
-- ClinicalNote, ClinicalOrder and VitalSigns, which already had it (the
-- design doc's original "5 models need this" claim was wrong for 3 of the
-- 5 - confirmed by reading the schema directly before writing this
-- migration; only Complaint and Prescription were actually missing it).
--
-- New models: AdmissionWardStay (per-admission ward/bed occupancy history,
-- needed to attribute a night's charge to the right ward across a
-- transfer), BedDayCharge (idempotency marker for the nightly bed-charge
-- job, built in F1b), AdmissionDeposit (cash held against a stay - never a
-- Payment row, see the design doc section 5 for why).
--
-- New Tenant settings: inpatientChargeRule (midnight-census vs rolling
-- 24h), shortStayChargeMode (how a stay crossing zero midnights is
-- charged), requireSettledBillAtDischarge (off by default).
--
-- Ward gains dailyRate/dayCaseRate (both nullable - an admission cannot be
-- opened against a ward with no dailyRate set, enforced in application
-- code, not a NOT NULL constraint, since existing wards have no rate yet).

-- CreateEnum
CREATE TYPE "InpatientChargeRule" AS ENUM ('MIDNIGHT_CENSUS', 'ROLLING_24H');

-- CreateEnum
CREATE TYPE "ShortStayChargeMode" AS ENUM ('NONE', 'MINIMUM_FULL_DAY', 'DAY_CASE_RATE');

-- AlterTable
ALTER TABLE "Admission" ADD COLUMN     "originatingVisitId" TEXT,
ADD COLUMN     "reopenedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "admissionId" TEXT;

-- AlterTable
ALTER TABLE "InsuranceClaim" ADD COLUMN     "admissionId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "admissionId" TEXT;

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "admissionId" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "inpatientChargeRule" "InpatientChargeRule" NOT NULL DEFAULT 'MIDNIGHT_CENSUS',
ADD COLUMN     "requireSettledBillAtDischarge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shortStayChargeMode" "ShortStayChargeMode" NOT NULL DEFAULT 'MINIMUM_FULL_DAY';

-- AlterTable
ALTER TABLE "Ward" ADD COLUMN     "dailyRate" DECIMAL(12,2),
ADD COLUMN     "dayCaseRate" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "AdmissionWardStay" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AdmissionWardStay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BedDayCharge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "nightOf" TIMESTAMP(3) NOT NULL,
    "invoiceLineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BedDayCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionDeposit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "receiptNumber" TEXT,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAmount" DECIMAL(12,2),
    "refundedAt" TIMESTAMP(3),
    "refundedById" TEXT,
    "refundReason" TEXT,

    CONSTRAINT "AdmissionDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdmissionWardStay_tenantId_idx" ON "AdmissionWardStay"("tenantId");

-- CreateIndex
CREATE INDEX "AdmissionWardStay_admissionId_idx" ON "AdmissionWardStay"("admissionId");

-- CreateIndex
CREATE INDEX "BedDayCharge_tenantId_idx" ON "BedDayCharge"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BedDayCharge_admissionId_nightOf_key" ON "BedDayCharge"("admissionId", "nightOf");

-- CreateIndex
CREATE INDEX "AdmissionDeposit_tenantId_idx" ON "AdmissionDeposit"("tenantId");

-- CreateIndex
CREATE INDEX "AdmissionDeposit_admissionId_idx" ON "AdmissionDeposit"("admissionId");

-- CreateIndex
CREATE INDEX "Admission_originatingVisitId_idx" ON "Admission"("originatingVisitId");

-- CreateIndex
CREATE INDEX "Invoice_admissionId_idx" ON "Invoice"("admissionId");

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionWardStay" ADD CONSTRAINT "AdmissionWardStay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionWardStay" ADD CONSTRAINT "AdmissionWardStay_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionWardStay" ADD CONSTRAINT "AdmissionWardStay_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionWardStay" ADD CONSTRAINT "AdmissionWardStay_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedDayCharge" ADD CONSTRAINT "BedDayCharge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDeposit" ADD CONSTRAINT "AdmissionDeposit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDeposit" ADD CONSTRAINT "AdmissionDeposit_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_originatingVisitId_fkey" FOREIGN KEY ("originatingVisitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
