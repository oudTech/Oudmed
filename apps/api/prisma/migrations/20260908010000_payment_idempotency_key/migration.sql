-- Payment idempotency: a client-generated per-attempt key so a retried
-- "Record payment" (double-click / network retry) does not create a second
-- payment. Nullable - existing and keyless payments are unaffected; Postgres
-- treats each (tenantId, NULL) as distinct so the unique index does not clash.

ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Payment_tenantId_idempotencyKey_key"
  ON "Payment"("tenantId", "idempotencyKey");
