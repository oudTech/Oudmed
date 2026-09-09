# Codebase map

A short orientation. The authoritative detail lives in the code and in the
`.claude/.../memory/` notes (indexed by `MEMORY.md`), not in a second copy here.

## Tree

```
apps/
  api/
    src/
      main.ts                 bootstrap: validateEnv, filter, throttler, CORS, pipe, Swagger
      app.module.ts           module wiring + global guards
      common/
        permissions.ts        action -> role matrix, can() / assertCan()   (mirrored in web)
        permissions.drift.spec.ts   fails the build if the web mirror drifts
        sequence.ts           gapless per-tenant counters (TenantSequence)
        env.validation.ts     boot-time fail-fast on missing / weak config
        filters/              AllExceptionsFilter
        audit*                AuditService
      prisma/
        schema.prisma         THE data model (source of truth)
        rls.sql               one DO block: RLS policy per tenant table + app-role grants
        apply-rls.ts          `pnpm prisma:rls`
        setup-app-role.ts     `pnpm db:setup-role`  (creates oudhealth_app)
        migrations/           20260904000000_init (frozen) + timestamped increments
        seed.ts               demo hospital + users
      auth/                   credentials login, email verify, JwtStrategy (re-checks DB every request)
      tenants/ directory/ schedule/ admissions/
      patients/ (+ clinical)  chart, complaints, diagnoses, vitals, prescriptions, documents
      encounters/             the consultation workspace
      pharmacy/ billing/ claims/ reports/ settings/ home/ staff/ admin/
      storage/                StorageService, FilesService, ScanService (clamd)
  web/
    app/
      (protected)/            auth-gated layout + every in-app screen
      login/ signup/ onboarding/ verify-email/ auth/callback/
      error.tsx global-error.tsx not-found.tsx loading.tsx   route boundaries
      middleware.ts           subdomain / session routing  (repo root: apps/web/middleware.ts)
    components/
      Providers.tsx           SessionProvider + QueryClientProvider + TokenSync + NetworkIndicator + FeedbackProvider
      AppShell.tsx            nav (filtered by can()), tenant branding
      ui/kit.tsx              design system (Modal, Drawer, Field, Input, Button, Badge)
      ui/feedback.tsx         useToast() / useConfirm()
    lib/
      api.ts                  axios singleton + 401 interceptor
      permissions.ts          copy of the API matrix (UI hiding only)
      <domain>.ts             typed API wrappers using @oudhealth/contracts
packages/
  contracts/                  @oudhealth/contracts  TypeScript interfaces, type-only
  validation/                 @oudhealth/validation  Zod schemas (patient registration, billing)
  config/                     shared tsconfig base
scripts/check-dashes.mjs      the no-Unicode-dash rule (also in CI)
```

## Key facts

- **Tenant isolation:** `PrismaService.forTenant(tenantId, fn)` opens a
  transaction and sets `app.tenant_id`. RLS policies filter on it. The API
  connects as `oudhealth_app` (NOSUPERUSER / NOBYPASSRLS) so a forgotten
  `where tenantId` cannot leak data.
- **Authorization:** one flat matrix in `common/permissions.ts`
  (`assertCan(role, action)`), copied into `apps/web/lib/permissions.ts` for the
  UI. `RolesGuard` / `@Roles()` survives only on `BillingController`.
- **Money:** `Prisma.Decimal`, never `number`. Invoice / receipt numbers come from
  `TenantSequence` (gapless, race-safe).
- **Contracts vs Prisma types:** the web never imports Prisma types. Shared shapes
  live in `packages/contracts` and are `import type` only in the API (erased at
  compile, so they never enter the API's runtime build).
- **Errors on the web:** every route group has `error.tsx` / `loading.tsx` /
  `not-found.tsx`; a 401 from the API triggers sign-out to `/login?reason=expired`.

## Where to read more

- System design and the request pipeline: [ARCHITECTURE.md](ARCHITECTURE.md)
- Dependency choices: [STACK.md](STACK.md)
- Core entities: [ERD.md](ERD.md); full model: `apps/api/prisma/schema.prisma`
- Per-feature history and decisions: the `memory/` notes (see `MEMORY.md`)
- Running and deploying: the repo `README.md` and [DEPLOY.md](DEPLOY.md)
