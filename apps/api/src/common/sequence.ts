import type { Prisma } from '@prisma/client';

/**
 * Allocate the next value of a per-tenant counter.
 *
 * MUST be called inside a `PrismaService.forTenant` transaction (so `app.tenant_id`
 * is set for RLS, and so the increment shares the caller's transaction). The row
 * lock taken here is held until that transaction commits or rolls back:
 *
 *  - concurrent callers for the same (tenant, kind) serialize and each get a
 *    distinct, consecutive value - no duplicate-key 500s under load;
 *  - if the caller's transaction rolls back, the increment rolls back too, so
 *    the number is never consumed. Invoice and receipt sequences stay gapless.
 *
 * The first call for a (tenant, kind) seeds the counter from `seedIfMissing()`
 * (normally the current row count for that entity) so existing data keeps its
 * numbering continuous without a separate backfill.
 */
export type SequenceKind =
  | 'invoice'
  | 'receipt'
  | 'patient'
  | 'admission'
  | 'claim'
  | 'claimBatch'
  | 'remittance';

export async function nextSequence(
  tx: Prisma.TransactionClient,
  tenantId: string,
  kind: SequenceKind,
  seedIfMissing: () => Promise<number>,
): Promise<number> {
  // Fast path: the counter row already exists. UPDATE ... RETURNING locks it.
  const bumped = await tx.$queryRaw<{ value: number }[]>`
    UPDATE "TenantSequence"
       SET "value" = "value" + 1, "updatedAt" = now()
     WHERE "tenantId" = ${tenantId} AND "kind" = ${kind}
    RETURNING "value"
  `;
  if (bumped.length) return bumped[0].value;

  // Slow path (once per tenant+kind, ever): seed from the existing row count.
  const seed = await seedIfMissing();
  const created = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "TenantSequence" ("tenantId", "kind", "value", "updatedAt")
    VALUES (${tenantId}, ${kind}, ${seed} + 1, now())
    ON CONFLICT ("tenantId", "kind")
    DO UPDATE SET "value" = "TenantSequence"."value" + 1, "updatedAt" = now()
    RETURNING "value"
  `;
  return created[0].value;
}

export type PlatformSequenceKind = 'subscriptionInvoice';

/**
 * Same race-safe gapless-counter approach as `nextSequence`, for documents
 * that belong to the platform (e.g. subscription invoice numbers) rather than
 * to one tenant - there is no `tenantId` dimension to key on.
 */
export async function nextPlatformSequence(
  tx: Prisma.TransactionClient,
  kind: PlatformSequenceKind,
): Promise<number> {
  const bumped = await tx.$queryRaw<{ value: number }[]>`
    UPDATE "PlatformSequence"
       SET "value" = "value" + 1, "updatedAt" = now()
     WHERE "kind" = ${kind}
    RETURNING "value"
  `;
  if (bumped.length) return bumped[0].value;

  const created = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "PlatformSequence" ("kind", "value", "updatedAt")
    VALUES (${kind}, 1, now())
    ON CONFLICT ("kind")
    DO UPDATE SET "value" = "PlatformSequence"."value" + 1, "updatedAt" = now()
    RETURNING "value"
  `;
  return created[0].value;
}
