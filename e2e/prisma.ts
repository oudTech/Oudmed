/**
 * Re-exports the already-generated Prisma client from apps/api (correct
 * types + query engine for the real schema) so every e2e file can just
 * `import { PrismaClient, Role, ... } from './prisma'` instead of each
 * repeating the relative path into apps/api/node_modules. A plain `pnpm
 * add @prisma/client` at the repo root would install a second, ungenerated
 * copy with no engine for this schema - this avoids that entirely.
 */
export * from '../apps/api/node_modules/@prisma/client';
