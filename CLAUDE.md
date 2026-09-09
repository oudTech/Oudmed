# CLAUDE.md

Guidance for working in this repo. Keep it short; deeper detail is in `docs/` and
in the per-feature `memory/` notes.

## What this is

Multi-tenant Hospital Management System. Turborepo + pnpm workspaces:

- `apps/api` - NestJS 10 + Prisma 5 + PostgreSQL 16
- `apps/web` - Next.js 14 (App Router) + NextAuth v5 + TanStack Query + Tailwind
- `packages/contracts` - shared TS interfaces (type-only), `packages/validation` - Zod schemas, `packages/config` - tsconfig base

One database, one schema; every tenant row carries `tenantId`; PostgreSQL
Row-Level Security enforces isolation. The API connects as the non-superuser
`oudhealth_app` role (`APP_DATABASE_URL`) so RLS cannot be bypassed.

## Run

```bash
pnpm install
docker compose up -d                                  # Postgres + MinIO
cd apps/api && cp .env.example .env                    # set APP_DB_PASSWORD + APP_DATABASE_URL
pnpm exec prisma migrate deploy && pnpm run db:setup-role && pnpm run prisma:rls && pnpm run seed
pnpm --filter @oudhealth/api run start:dev             # :3000, Swagger /docs
pnpm --filter @oudhealth/web run dev                   # :3001
```

Demo: `admin@demo.com` / `Admin1234!` at `demo.localhost:3001`.

## Verify (run before finishing a change)

```bash
node scripts/check-dashes.mjs
pnpm --filter @oudhealth/api exec tsc --noEmit
pnpm --filter @oudhealth/web exec tsc --noEmit
pnpm --filter @oudhealth/api test        # needs Docker up (real Postgres + MinIO)
```

## Non-negotiables

- **No em-dashes, en-dashes, or Unicode minus signs** anywhere in code, comments
  or copy. ASCII hyphen-minus only. `U+2500` box-drawing in comment dividers is
  allowed. `scripts/check-dashes.mjs` enforces this.
- User-facing term is **"hospital"**, never "clinic".
- Every new tenant table needs a policy in `apps/api/prisma/rls.sql` (then
  `pnpm run prisma:rls` + `pnpm run db:setup-role`). No policy = data leak.
- Authorization is `assertCan(actor.role, '<action>')` against the matrix in
  `apps/api/src/common/permissions.ts`; the copy in `apps/web/lib/permissions.ts`
  must match (`permissions.drift.spec.ts` fails the build otherwise).
- Money is `Prisma.Decimal`, never `number`. Sequential numbers via
  `common/sequence.ts` (`nextSequence`), never `count() + 1`.
- DB reads/writes go through `PrismaService.forTenant(tenantId, fn)`.
- Migrations are incremental: `20260904000000_init` is frozen; add timestamped
  folders. `prisma migrate dev` needs a TTY; otherwise `prisma db execute` +
  `prisma migrate resolve --applied`.

## Conventions

- Web: RSC only for the two auth-gate layouts; everything else `'use client'`.
  Server state is TanStack Query. Forms are hand-rolled `useState` except the
  patient registration wizard (React Hook Form + Zod). UI from
  `components/ui/kit.tsx`; feedback via `useToast` / `useConfirm`, never
  `alert()` / `confirm()`.
- Brand accent is the Tailwind `primary` token (`var(--brand-primary)`), themed
  per tenant. Do not hardcode `#3366E3` in new class names.
- The web app never imports Prisma types; shared shapes come from
  `@oudhealth/contracts`.

## More

`README.md` (setup), `BUILD_GUIDE.md` (how to add a module), `docs/ARCHITECTURE.md`,
`docs/STACK.md`, `docs/ERD.md`, `docs/CODEBASE.md`, `docs/DEPLOY.md`.
