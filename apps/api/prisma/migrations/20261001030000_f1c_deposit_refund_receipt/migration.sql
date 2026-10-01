-- F1c: AdmissionDeposit gets its own refund receipt number, distinct from
-- the deposit-taken receipt number. F1a's refundDeposit() generated a refund
-- receipt number but never persisted it, so a refund receipt could not be
-- reliably re-fetched later - caught while wiring discharge's own refund
-- step, which needs the same receipt to be retrievable afterward.
--
-- Generated via `prisma migrate diff`, excluding the same unrelated
-- pre-existing `DROP INDEX "SubscriptionInvoice_tenantId_idx"` drift as the
-- prior two migrations.

ALTER TABLE "AdmissionDeposit" ADD COLUMN "refundReceiptNumber" TEXT;
