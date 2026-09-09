# OudHealth HMS

Multi-tenant Hospital Management System for African healthcare providers. One
codebase serves many hospitals; each hospital's data is isolated by `tenantId`
and enforced at the database with PostgreSQL Row-Level Security.

## Stack

- **API:** NestJS 10 (TypeScript) + Prisma 5 + PostgreSQL 16
- **Web:** Next.js 14 (App Router) + Tailwind + TanStack Query + NextAuth v5
- **Storage:** S3-compatible object storage (MinIO in dev)
- **Monorepo:** Turborepo + pnpm workspaces
- **Auth:** walled garden. Per-tenant users, subdomain login
  (`<slug>.<root-domain>`), credentials + email verification. No external IdP.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design,
[docs/STACK.md](docs/STACK.md) for the full dependency list, and
[apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma) for the data model.

## Layout

```
apps/
  api/        NestJS API
  web/        Next.js app
packages/
  contracts/  @oudhealth/contracts  shared TypeScript interfaces (type-only)
  validation/ @oudhealth/validation  shared Zod schemas (web forms)
  config/     @oudhealth/config      shared tsconfig base
docs/         architecture, stack, ERD, codebase map
docker-compose.yml   dev infrastructure (Postgres + MinIO)
```

## Prerequisites

- Node.js 20, pnpm 9+ (`corepack enable`)
- Docker (for Postgres + MinIO)

## Quick start

```bash
pnpm install
docker compose up -d                    # Postgres + MinIO

cd apps/api
cp .env.example .env
# set APP_DB_PASSWORD, then point APP_DATABASE_URL's password at it
pnpm exec prisma migrate deploy
pnpm run db:setup-role                   # create the non-superuser app role (RLS)
pnpm run prisma:rls                      # apply Row-Level Security policies
pnpm run seed                            # demo hospital + users (prints logins)

# two terminals, from the repo root:
pnpm --filter @oudhealth/api run start:dev    # http://localhost:3000  (Swagger at /docs)
pnpm --filter @oudhealth/web run dev          # http://localhost:3001
```

The owner connection (`DATABASE_URL`) runs migrations, seed and `prisma:rls`; the
API process itself connects as `oudhealth_app` (`APP_DATABASE_URL`, NOSUPERUSER /
NOBYPASSRLS) so RLS is actually enforced.

Demo login after seed: `admin@demo.com` / `Admin1234!` at `demo.localhost:3001`
(the seed output lists the other roles).

## Common commands

```bash
pnpm --filter @oudhealth/api test                 # jest, real Postgres + MinIO
pnpm --filter @oudhealth/api exec tsc --noEmit     # typecheck
pnpm --filter @oudhealth/web exec tsc --noEmit
node scripts/check-dashes.mjs                      # the no-Unicode-dash rule
cd apps/api && pnpm run db:sync                    # after a schema change: generate + re-apply RLS
```

## Schema changes

Migrations are incremental. `20260904000000_init` is the frozen baseline; each new
change is its own timestamped folder under `apps/api/prisma/migrations`, applied
with `prisma migrate deploy` (or, where a TTY is available, `prisma migrate dev`).
Any new table must be added to `apps/api/prisma/rls.sql` and picked up by
`pnpm run prisma:rls`, and `pnpm run db:setup-role` re-run so the app role can see
it. A table without an RLS policy is a cross-tenant data leak.

## Deployment

See [docs/DEPLOY.md](docs/DEPLOY.md). A hosting target has not been finalised; the
Dockerfiles in `apps/*/Dockerfile` are structurally complete but not yet built in
CI.
