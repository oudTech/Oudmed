-- F1b: BedDayCharge.invoiceLineId becomes nullable.
--
-- A null row (rather than no row at all) marks a night/short-stay that was
-- evaluated and found to be legitimately free (ShortStayChargeMode.NONE) -
-- distinct from "not yet evaluated/held for a missing ward rate", which
-- still gets no row at all so the nightly cron or discharge reconciliation
-- retries it. See apps/api/src/admissions/bed-charges.service.ts.
--
-- Generated via `prisma migrate diff --from-url <local-db> --to-schema-datamodel
-- prisma/schema.prisma --script`, then hand-reviewed: the raw diff also
-- contained an unrelated `DROP INDEX "SubscriptionInvoice_tenantId_idx"` -
-- pre-existing drift between the dev database and the schema, not part of
-- this change - which is deliberately excluded here.

ALTER TABLE "BedDayCharge" ALTER COLUMN "invoiceLineId" DROP NOT NULL;
