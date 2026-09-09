# Working on OudHealth

The scaffold and the core modules are built. This is how to make a change
without breaking the multi-tenant guarantees.

## Before you start

Run `./scripts/setup.sh` (or `scripts/setup.ps1` on Windows), then start the two
dev servers. See the [Local setup](README.md#local-setup) section of the README
for the full walkthrough, prerequisites, and demo logins.

## Adding or changing a database table

1. Edit `apps/api/prisma/schema.prisma`. Every tenant-scoped model needs
   `tenantId String` + a `tenant` relation + `@@index([tenantId])`.
2. Create the migration:
   - with a TTY: `pnpm exec prisma migrate dev --name <change>`
   - otherwise: write `apps/api/prisma/migrations/<timestamp>_<change>/migration.sql`
     by hand, then `pnpm exec prisma db execute --file <that file> --schema prisma/schema.prisma`
     and `pnpm exec prisma migrate resolve --applied <timestamp>_<change>`.
3. Add the table to the `FOREACH` list in `apps/api/prisma/rls.sql`.
4. `pnpm run db:sync` (regenerates the client and re-applies RLS) and
   `pnpm run db:setup-role` (so the app role can see the new table).

> A new tenant table without an RLS policy is a cross-tenant data leak. Step 3 is
> not optional.

## Adding an API endpoint

- Business logic goes in a service method that takes the `actor` (not a bare
  `tenantId`) and calls `assertCan(actor.role, '<action>')`.
- Add the action to the matrix in `apps/api/src/common/permissions.ts` **and** the
  copy in `apps/web/lib/permissions.ts` (the drift spec enforces this).
- Reads and writes go through `PrismaService.forTenant`.
- Record an audit row on writes (`AuditService`).
- Money is `Prisma.Decimal`. Sequential numbers come from `nextSequence`.

## Adding a web screen

- New route under `apps/web/app/(protected)/<area>/page.tsx`, `'use client'`.
- Server state via TanStack Query and a typed wrapper in `apps/web/lib/<area>.ts`
  using `@oudhealth/contracts` types (never Prisma types).
- Gate the nav entry and the route with `can(session?.role, '<action>')`.
- Use `components/ui/kit.tsx` for inputs / modals and `useToast` / `useConfirm`
  from `components/ui/feedback.tsx` (no `alert()` / `confirm()`).

## Before you push

```bash
node scripts/check-dashes.mjs                       # no Unicode dashes / minus signs
pnpm --filter @oudhealth/api exec tsc --noEmit
pnpm --filter @oudhealth/web exec tsc --noEmit
pnpm --filter @oudhealth/api test                   # real Postgres + MinIO
```

CI (`.github/workflows/ci.yml`) runs the same chain plus the web build.

## House rules

- No em-dashes, en-dashes or Unicode minus signs anywhere in code or copy. ASCII
  hyphen-minus only. `U+2500` box-drawing in a comment divider is fine.
- The user-facing word is "hospital", never "clinic".
- Preserve existing behaviour unless you are intentionally changing it; call out
  tech debt rather than silently working around it.
