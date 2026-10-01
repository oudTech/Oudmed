-- F1c correction: discharge must never block on a deposit refund still
-- being due. A pending refund is recorded (amount, admission, reason) and
-- shown on a "refunds due" list; paying it out later issues the refund
-- receipt/cash-ledger entry exactly as an immediate refund would.
--
-- Generated via `prisma migrate diff`, excluding the same unrelated
-- pre-existing `DROP INDEX "SubscriptionInvoice_tenantId_idx"` drift as the
-- earlier F1 migrations.

CREATE TABLE "AdmissionRefund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "method" TEXT,
    "reference" TEXT,
    "receiptNumber" TEXT,

    CONSTRAINT "AdmissionRefund_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdmissionRefund_tenantId_idx" ON "AdmissionRefund"("tenantId");

CREATE INDEX "AdmissionRefund_admissionId_idx" ON "AdmissionRefund"("admissionId");

CREATE INDEX "AdmissionRefund_tenantId_status_idx" ON "AdmissionRefund"("tenantId", "status");

ALTER TABLE "AdmissionRefund" ADD CONSTRAINT "AdmissionRefund_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdmissionRefund" ADD CONSTRAINT "AdmissionRefund_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
