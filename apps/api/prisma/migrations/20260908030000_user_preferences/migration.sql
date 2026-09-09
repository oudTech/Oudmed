-- Per-user preferences: guided-tour / onboarding progress and dismissed
-- feature callouts. Nullable JSONB - existing rows are unaffected, no backfill,
-- no table rewrite, only a fast catalog update. User is not an RLS table and the
-- `oudhealth_app` table-level grant already covers new columns.

ALTER TABLE "User" ADD COLUMN "preferences" JSONB;
