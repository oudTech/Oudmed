import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // The running app connects as the dedicated non-superuser role (APP_DATABASE_URL)
    // so PostgreSQL row-level security is actually enforced. Migrations, `seed` and
    // `apply-rls` keep using DATABASE_URL (the owner). Falls back to DATABASE_URL when
    // APP_DATABASE_URL is not set, for first-run / local convenience.
    const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
    super(url ? { datasources: { db: { url } } } : undefined);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Runs a callback inside a transaction scoped to one tenant. `app.tenant_id` is
   * set for the transaction so RLS policies filter every query; the value is bound
   * as a parameter (no interpolation).
   *
   * Timeouts are raised above Prisma's 5s / 2s defaults: gapless document
   * numbering (common/sequence.ts) takes a row lock held for the rest of the
   * transaction, so bursts of concurrent same-tenant writes serialize. The wider
   * window keeps that queueing from surfacing as transaction-timeout 500s.
   */
  async forTenant<T>(
    tenantId: string,
    fn: (tx: PrismaClient) => Promise<T>,
    opts: { timeout?: number; maxWait?: number } = {},
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return fn(tx as unknown as Prisma.TransactionClient as PrismaClient);
      },
      { timeout: opts.timeout ?? 15_000, maxWait: opts.maxWait ?? 10_000 },
    );
  }
}
