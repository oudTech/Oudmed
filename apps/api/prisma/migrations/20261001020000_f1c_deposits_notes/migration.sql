-- F1c: deposit application pool, and admission ward-round notes.
--
-- AdmissionDeposit.appliedAmount: apply-deposit/discharge auto-apply consume
-- a deposit's available credit (amount - appliedAmount - refundedAmount),
-- the same pool a refund already draws from - see
-- apps/api/src/admissions/admissions.service.ts applyDeposit().
--
-- ClinicalNoteAddendum: visitId becomes optional and gains admissionId/noteId
-- so a late correction can target one specific dated ward-round note on an
-- admission (which has many ClinicalNote rows), not just "the visit's one
-- note" as before. Existing visit-addendum rows and behaviour are untouched.
--
-- Generated via `prisma migrate diff --from-url <local-db> --to-schema-datamodel
-- prisma/schema.prisma --script`, then hand-reviewed: the raw diff also
-- contained an unrelated `DROP INDEX "SubscriptionInvoice_tenantId_idx"` -
-- pre-existing drift between the dev database and the schema, not part of
-- this change - which is deliberately excluded here.

ALTER TABLE "ClinicalNoteAddendum" DROP CONSTRAINT "ClinicalNoteAddendum_visitId_fkey";

ALTER TABLE "AdmissionDeposit" ADD COLUMN "appliedAmount" DECIMAL(12,2);

ALTER TABLE "ClinicalNoteAddendum" ADD COLUMN "admissionId" TEXT,
ADD COLUMN "noteId" TEXT,
ALTER COLUMN "visitId" DROP NOT NULL;

CREATE INDEX "ClinicalNote_admissionId_idx" ON "ClinicalNote"("admissionId");

CREATE INDEX "ClinicalNoteAddendum_admissionId_idx" ON "ClinicalNoteAddendum"("admissionId");

CREATE INDEX "ClinicalNoteAddendum_noteId_idx" ON "ClinicalNoteAddendum"("noteId");

ALTER TABLE "ClinicalNoteAddendum" ADD CONSTRAINT "ClinicalNoteAddendum_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClinicalNoteAddendum" ADD CONSTRAINT "ClinicalNoteAddendum_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ClinicalNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
