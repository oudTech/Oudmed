# Hospital Management System - Complete System Flow & Operations Guide

Consolidated reference for how OudHealth actually behaves today, what has been
verified versus assumed, and how to run and troubleshoot it in production. This
is the single "state of the system" document; deeper detail on any one area
still lives in [ARCHITECTURE.md](ARCHITECTURE.md), [STACK.md](STACK.md),
[CODEBASE.md](CODEBASE.md), [ERD.md](ERD.md), [DEPLOY.md](DEPLOY.md), and the
per-feature `memory/` notes - this guide links out to those rather than
duplicating them, except where it adds information not written down elsewhere
(user journeys, state machines, a verification ledger, troubleshooting).

**How to read the status tags used throughout:** every claim of fact below is
one of **Verified** (exercised end to end - an automated test, a real HTTP
call, or a manual click-through - by someone in this project, with the method
noted), **Implemented, not independently tested** (the code exists and reads
correctly but has not been exercised end to end), **Planned** (does not exist
yet), or **Unknown** (not checked). Nothing here is marked Verified on the
strength of the code merely compiling or looking right.

---

## 1. System overview

OudHealth is a multi-tenant Hospital Management System: one deployment serves
many hospitals ("tenants"), each with its own staff, patients, and financial
records, isolated from every other tenant's data. A hospital's staff sign in
at their own subdomain (e.g. `demo.oudmed.com`); there is no cross-tenant
login and, as of this writing, no platform operator console (see [section 6](#6-super-admin--platform-administration-p2-not-yet-built)).

The system covers the operational loop of a small-to-mid hospital: register a
patient, book or walk them into an appointment, check them in, see a doctor,
record vitals/diagnosis/prescription/orders, dispense drugs, run labs, bill
the visit (cash or HMO), collect payment, and - for inpatients - admit, manage
a bed, and discharge. Supporting modules cover staff/HR, master data
(services, departments, insurance payers), reporting, and hospital branding.

**Verified**: the full monorepo (`apps/api`, `apps/web`) builds and typechecks
cleanly on both Windows (local dev) and Linux (Docker, matching the production
target) as of this writing.

## 2. Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the request pipeline diagram and
[STACK.md](STACK.md) for the technology choices. Summary: NestJS 10 API +
Prisma 5 + PostgreSQL 16, Next.js 14 (App Router) web app, one shared database
with tenant isolation enforced by PostgreSQL Row-Level Security. The API
process connects to Postgres as a non-superuser role (`oudhealth_app`,
`NOSUPERUSER`/`NOBYPASSRLS`) specifically so that a bug in application code
(a forgotten `where tenantId`) cannot leak another hospital's data - RLS is a
database-level backstop, not just an application convention.

**Verified**: `apps/api/src/prisma/rls.int-spec.ts` proves cross-tenant
isolation with a real second tenant and a real query attempt, as part of the
143-test suite (see [section 12](#12-verification-ledger)).

## 3. User roles & permissions

Eight roles, all tenant-bound (a `User.tenantId` is required for every role,
including `SUPER_ADMIN` - there is no platform-wide identity today):

| Role | Typical user |
|---|---|
| `HOSPITAL_ADMIN` | Hospital owner/manager - full access within their tenant |
| `DOCTOR` | Consultations, diagnosis, prescriptions, clinical notes, orders |
| `NURSE` | Vitals, admissions, bed management, appointment operations |
| `RECEPTIONIST` | Patient registration, scheduling, check-in, front-desk billing |
| `PHARMACIST` | Drug inventory, dispensing |
| `LAB_STAFF` | Lab/imaging worklist and results |
| `ACCOUNTANT` | Billing, claims, reports |
| `SUPER_ADMIN` | Bypasses the permission matrix entirely (see [section 6](#6-super-admin--platform-administration-p2-not-yet-built)) - still scoped to one tenant |

The full action -> role matrix is `apps/api/src/common/permissions.ts` (the
authority) mirrored in `apps/web/lib/permissions.ts` (UI hiding only); a
dedicated test, `permissions.drift.spec.ts`, fails the build if the two ever
diverge. As of this writing the matrix has 30 actions. Selected highlights:

| Action | Allowed roles |
|---|---|
| `patient:register` / `patient:read` / `patient:edit` | Receptionist, Nurse, Doctor, Hospital Admin |
| `vitals:record` | Nurse, Doctor, Hospital Admin |
| `diagnosis:record` / `prescription:write` / `note:write` / `order:create` | Doctor, Hospital Admin |
| `prescription:dispense` / `pharmacy:manage` | Pharmacist, Hospital Admin |
| `order:result` | Lab Staff, Doctor, Hospital Admin |
| `invoice:pay` / `billing:manage` | Receptionist, Accountant, Hospital Admin |
| `claims:manage` / `reports:view` | Hospital Admin, Accountant |
| `staff:manage` / `admin:settings` / `ward:manage` / `doctor:set-hours` | Hospital Admin only |

Note `patient:read` deliberately excludes Pharmacist, Lab Staff, and
Accountant - their workflows are served by dedicated queues (dispensing queue,
lab worklist, invoice list) that surface only the minimal patient identifiers
each role needs, not the full chart.

Authorization is checked in two places, and both must agree by design: the
API calls `assertCan(role, action)` (the actual security boundary - a 403 if
it fails) and the web app calls `can(role, action)` to hide or disable the
corresponding button. **The frontend check is a UX convenience only; it is
never the security boundary.** An API call made directly (curl, a modified
request) is still subject to `assertCan`.

**Verified**: `permissions.drift.spec.ts` passes (matrices match) as part of
the 143-test suite.

## 4. Complete user journeys

These are the actual click-paths through the app today, role by role.

### 4.1 Receptionist: register -> book -> check in -> bill

1. `/patients` -> "Add patient" -> 8-step registration wizard (demographics,
   contact, next of kin, insurance/payer, ID document, photo, consent,
   review). The patient record is created as soon as step 2 completes
   (`patientNumber` assigned, e.g. `PT-00001`), so the wizard is resumable via
   `/patients/new?id=<id>` if abandoned partway.
2. `/schedule` -> "New appointment" -> pick patient, doctor, department, time.
3. On the day: `/schedule` -> open the appointment -> "Check in".
4. After the visit is billed (automatically, see [section 5.2](#52-billing--the-money-loop)):
   `/billing` -> find the invoice -> "Record payment" -> choose payer/method
   -> a printable receipt (`RCP-...`) is generated.

### 4.2 Doctor: consult -> diagnose -> prescribe -> order

1. `/schedule` (today's list, filtered to the doctor) -> open a checked-in
   appointment -> "Start" (moves the visit to `IN_PROGRESS`, opens the
   consultation workspace at `/encounters/[visitId]`).
2. In the workspace: record/confirm the presenting complaint, review vitals
   (nurse-entered or entered here), record a diagnosis, write a prescription
   (autocompletes from the pharmacy drug catalogue), place lab/imaging orders,
   write a SOAP clinical note.
3. "Complete" moves the visit to `COMPLETED`; this is also the trigger that
   posts the visit's billable items to a single invoice (see [4.4](#44-the-billing-trigger)).
4. The patient's full history is visible any time via `/patients/[id]`'s
   10-tab chart (Investigations, Prescriptions, Diagnoses, Documents, etc).

### 4.3 Nurse: vitals -> admission -> ward care

1. Vitals can be recorded from the encounter workspace or the patient chart.
2. For an inpatient: `/schedule` -> open the visit -> "Admit this patient" ->
   pick a ward and bed -> creates an `Admission` and flips the bed to
   `OCCUPIED`.
3. `/wards` shows ward/bed occupancy; a bed's status can be toggled
   (`bed:set-status`) for maintenance, etc.
4. Discharge happens from the admission's own detail view: a two-step flow
   (view -> discharge form with outcome + notes -> "Confirm discharge"), not a
   single destructive click.

### 4.4 The billing trigger

There is exactly one invoice per visit, generated automatically the first
time chargeable activity is posted to that visit (a diagnosis, a
prescription, an order, or completing the visit) via
`BillingService.postChargeToVisit`, which takes a per-visit advisory lock so
concurrent writers (e.g. a doctor prescribing while a nurse records vitals)
cannot create two invoices for the same visit. The invoice inherits the
visit's payer type (cash/HMO/NHIS/retainer) set at booking. Ad-hoc invoices
(not tied to a visit) can also be built directly from `/billing/new` using the
service catalogue.

### 4.5 Pharmacist: dispense

`/pharmacy` -> Dispensing tab -> the queue of active prescriptions ->
"Confirm dispense" decrements stock earliest-expiry-first (FEFO) across the
drug's batches; if stock is insufficient the API returns a 409
(`INSUFFICIENT_STOCK`) rather than allowing a partial silent short-dispense.
Inventory itself (drug catalogue, batches, CSV import, stock movements) is
the Inventory tab of the same screen.

### 4.6 Lab staff: result orders

`/lab` -> worklist of `ORDERED`/`IN_PROGRESS` lab and imaging orders -> enter
results -> order moves to `RESULTED`, visible back on the requesting doctor's
patient chart / encounter.

### 4.7 Accountant: HMO claims lifecycle

`/claims` -> generate claims from a hospital's HMO-payer visit invoices ->
submit -> batch per provider -> export a schedule (CSV) to send the HMO ->
when the HMO remits, record the remittance: allocate approved/paid/shortfall
amounts across the batch's claims, which posts real `Payment` rows onto the
underlying invoices. A shortfall can be written off (posts a negative "HMO
Adjustment" line), billed to the patient, or appealed. `/reports` also
surfaces a receivables-aging view across open claims.

### 4.8 Hospital Admin: full walkthrough

The Hospital Admin can do everything above, plus the admin-only screens:

- `/hr` - staff directory: add staff (admin sets an initial password directly,
  no invite email flow), assign departments, deactivate/reactivate (guarded
  against deactivating yourself or the last remaining admin), reset a staff
  member's password. Both deactivation and password-reset now require an
  explicit confirmation dialog (`useConfirm()`) before executing - fixed this
  pass, see [section 12](#12-verification-ledger).
- `/admin` - master data: Services (the billing catalogue), Departments,
  Insurance & companies (payers used in patient registration and billing).
  Deletes are guarded when the record is in use.
- `/settings` - hospital profile, branding (logo, brand color), invoice/receipt
  number prefixes.
- `/reports` - financial + operational KPIs, collections and patient-volume
  trends, revenue by department/doctor, a filterable and CSV-exportable
  payment ledger.
- `/dashboard` - role-aware landing screen and widgets (every role gets one,
  tailored to what they do).

## 5. Status & state machines

### 5.1 Appointment / visit (`VisitStatus`)

```
SCHEDULED -> CHECKED_IN -> IN_PROGRESS -> COMPLETED
     |            |             |
     +--> CANCELLED / NO_SHOW <-+   (reversible back to SCHEDULED via "reopen")
```

Each transition is its own permission (`appointment:check-in`,
`appointment:start`, `appointment:complete`, `appointment:cancel`,
`appointment:no-show`, `appointment:reopen`) so, for example, a receptionist
can check a patient in but only a doctor/nurse can mark a visit `IN_PROGRESS`.
`CANCELLED` and `NO_SHOW` are the two transitions that halt the workflow and,
since this pass, require an explicit confirmation dialog on the web (see
[section 12](#12-verification-ledger)); the forward transitions do not, since
they are expected, low-risk, frequent actions.

### 5.2 Admission (`AdmissionStatus`)

`ADMITTED -> DISCHARGED` (or `TRANSFERRED_OUT`, `DECEASED`, `ABSCONDED`, each a
terminal state reached via the same discharge-style form).

### 5.3 Invoice (`InvoiceStatus`)

`UNPAID -> PARTIAL -> PAID`, or `CANCELLED` from any pre-paid state (with a
required reason, logged). Payments can individually be reversed (also
reason-required, since this pass gated behind a confirmation dialog instead of
a raw text prompt - see [section 12](#12-verification-ledger)), which recomputes
the invoice's paid/balance amounts.

### 5.4 Prescription (`PrescriptionStatus`) / dispense (`DispenseStatus`)

Prescription: `ACTIVE -> COMPLETED` (fully dispensed) or `CANCELLED`. Dispense:
`PENDING -> PARTIAL -> DISPENSED`, or `CANCELLED`.

### 5.5 Clinical order (`OrderStatus`)

`ORDERED -> IN_PROGRESS -> RESULTED`, or `CANCELLED`.

### 5.6 HMO claim (`ClaimStatus`) / batch (`ClaimBatchStatus`)

Claim: `DRAFT -> SUBMITTED -> PART_PAID/PAID`, or `REJECTED`/`WRITTEN_OFF`/
`CANCELLED`. Batch: `OPEN -> SUBMITTED -> RECONCILED -> CLOSED`.

## 6. Super Admin / platform administration (P2, not yet built)

**Status: Planned, explicitly deferred.** During this build phase the team
audited how far Super Admin actually goes and found: `Role.SUPER_ADMIN`
bypasses the permission matrix (`can()` returns `true` unconditionally) but
**`User.tenantId` is a required field for every role, including
`SUPER_ADMIN`** - there is no platform-wide identity, and
`apps/api/src/tenants/tenants.controller.ts` exposes only three public
routes (`POST /tenants` for self-serve hospital sign-up, `GET
/tenants/check-slug`, `GET /tenants/resolve`). No API exists today for one
account to manage, list, or act on other tenants.

The explicit decision this pass (per direct instruction) was to **not**
implement a platform-wide Super Admin dashboard, and to **not** add an
emergency tenant-deactivation capability. Both are deferred to a future
architecture pass. If a real platform-operator need arises before then, the
starting design questions are: does a platform operator get their own
tenant-independent identity table, or does `SUPER_ADMIN` become the first
user of a reserved "platform" tenant; and does cross-tenant data access go
through the same RLS-bound `PrismaService.forTenant` (looping per tenant) or a
separate bypass connection (much larger blast radius, needs its own audit
trail design).

## 7. Security model

- **Tenant isolation**: PostgreSQL RLS, enforced because the API connects as a
  non-superuser role. Verified by an automated cross-tenant test
  (`rls.int-spec.ts`).
- **AuthN**: per-tenant credentials (bcrypt, 12 rounds), JWT session tokens,
  email verification required before login (Resend, or logs the link if
  unconfigured), a short-lived pre-tenant "pending token" during sign-up, and
  a one-time ticket handoff pattern for the transition from pending to full
  session. **Verified**: 6 real HTTP integration tests
  (`auth-audit.int-spec.ts`) cover login success/failure, unverified-account
  blocking, and the full forgot/reset-password flow.
- **AuthZ**: `assertCan(role, action)` server-side (the real boundary),
  mirrored client-side for UI only. Every request also re-reads the user from
  the database (not just the JWT claims), so a deactivated account or a role
  change takes effect on the very next request, not at next login.
- **Audit trail**: `AuditService.record(...)` appends an immutable row (raw
  `INSERT`, bypassing the SELECT RLS check that would otherwise apply) for
  writes across nearly every module (staff, billing, claims, patients,
  pharmacy, admissions, wards, settings, storage) and, since this pass, auth
  events: `LOGIN_SUCCESS`, `LOGIN_FAILED` (records the attempted email even
  when no matching user exists, with a null `userId`), `LOGIN_BLOCKED_UNVERIFIED`,
  `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`, `TICKET_REDEEMED`.
  **Verified**: all 6 of the above via real HTTP calls in
  `auth-audit.int-spec.ts`.
- **Rate limiting**: `@nestjs/throttler` on all auth endpoints (register,
  login, forgot-password, etc). **Known limitation**: in-memory, per-instance
  - running more than one API replica multiplies the effective limit. Fine for
  a single-instance pilot deployment; needs a shared store (Redis) before
  horizontal scaling.
- **File uploads**: magic-byte validated on upload, optional malware scanning
  (clamd, opt-in via `CLAMAV_HOST`), served only via short-lived presigned
  URLs (300s general, 120s for some, 600s for logos) minted on click rather
  than embedded in list responses, and an orphan sweeper endpoint.
- **Error tracking**: Sentry, added this pass to both the API
  (`@sentry/node`) and the web app (`@sentry/nextjs`, both client-side error
  boundaries and the App Router's `instrumentation.ts` server hook). Designed
  as a safe no-op with no `SENTRY_DSN` set - confirmed against the existing
  unit test suite with zero mocking required, and confirmed via 2+ full
  Docker Linux builds that the integration does not break the production
  build. **Status: implemented, not yet exercised against a real Sentry
  project** (no DSN has been provisioned yet) - the plumbing is verified, the
  actual alert-on-error path is not.

## 8. Error handling

Every API error passes through `AllExceptionsFilter`: a known `HttpException`
is returned unchanged (status + message + any structured `code`); anything
else becomes a generic 500 with an `x-request-id` header (so a user can quote
that id when reporting an issue) and is reported to Sentry when configured.
On the web, every route group has its own `error.tsx` / `loading.tsx` /
`not-found.tsx` boundary, plus a global `global-error.tsx` for failures that
occur above the normal provider tree; a 401 response from the API globally
triggers sign-out to `/login?reason=expired` rather than leaving the user on
a broken screen.

**Known gap**: there is no automated frontend test suite (unit or e2e) for
`apps/web` at all - this predates this build phase. Web-side changes in this
phase were verified by TypeScript strict-mode compilation, real Docker Linux
builds (matching the production container target), and manual click-through,
never by an automated test asserting UI behavior. This is stated explicitly
per this phase's "do not claim more than is verified" rule, not glossed over.

## 9. Operational guide

### Local development
See the root [README.md](../README.md) and the "Run" section of
[CLAUDE.md](../CLAUDE.md): `pnpm install`, `docker compose up -d` (Postgres +
MinIO), migrate + set up the `oudhealth_app` role + apply RLS + seed, then run
both apps. Demo login: `admin@demo.com` / `Admin1234!` at
`demo.localhost:3001`. Additional seeded demo logins per role: `reception@`,
`nurse@`, `j.jumbo@` (doctor), `pharmacy@`, `lab@`, `accounts@` -
`Password1`.

### Verify before finishing any change
```bash
node scripts/check-dashes.mjs
pnpm --filter @oudhealth/api exec tsc --noEmit
pnpm --filter @oudhealth/web exec tsc --noEmit
pnpm --filter @oudhealth/api test        # needs Docker up (real Postgres + MinIO)
```
For any web-side change, additionally do a real Docker Linux build
(`docker build -f apps/web/Dockerfile ...`) before trusting it - this
codebase has repeatedly hit real Windows-vs-Linux discrepancies that a local
`next build`/`tsc` pass alone did not catch (a `next/og` crash, a `tsc`
rootDir issue, an OpenSSL/Alpine issue).

### Deploying
See [DEPLOY.md](DEPLOY.md) - hosting is on Render (`render.yaml`), with Neon
as the managed Postgres and Cloudflare R2 as S3-compatible object storage.
Every API boot re-runs `prisma migrate deploy` and re-applies `rls.sql`
(idempotent). `NEXT_PUBLIC_*` web env vars are baked in at Docker build time,
so changing one needs a redeploy, not just a restart.

### Database migrations
Incremental only. `20260904000000_init` is the frozen baseline; every schema
change since is its own timestamped folder under
`apps/api/prisma/migrations/`, applied via `prisma db execute` +
`prisma migrate resolve --applied` where `prisma migrate dev` isn't available
(it needs a TTY). After any schema change: `pnpm db:sync` (= `prisma generate`
+ `pnpm run prisma:rls`) to regenerate the client and re-apply/self-heal RLS
grants. **Every new tenant-scoped table needs its own RLS policy in
`apps/api/prisma/rls.sql`** - this is the single most important rule in the
codebase; a missing policy is a real data leak, not a theoretical one.

### Backup & restore
Neon (the production Postgres) supports point-in-time restore/preview.
**Verified** this pass: a "Preview data" (non-destructive, browses historical
state) succeeded at ~4 hours back and correctly failed ("Date is beyond the
history retention") at ~24 hours back on the current plan. **This means the
effective backup window today is under 24 hours** - a real risk for
production patient data, flagged explicitly rather than assumed adequate.
Upgrading Neon's plan for a longer retention window is a pre-launch decision
the hospital/operator needs to make consciously, not a default that was
silently accepted. Note the distinction: "Restore" overwrites the live branch
destructively; "Preview data" does not - always confirm which one a workflow
is about to trigger.

## 10. Known limitations (as of this writing)

- No platform-wide Super Admin / tenant management capability (see
  [section 6](#6-super-admin--platform-administration-p2-not-yet-built)).
- No emergency tenant-deactivation mechanism (explicitly out of scope this
  pass).
- Rate limiting is in-memory/per-instance, not distributed.
- No structured request logging (explicitly skipped this pass; the code has
  request-id tagging on errors via `AllExceptionsFilter`, but no general
  structured access/operation log).
- No automated frontend test suite.
- Neon's free-tier backup retention window is under 24 hours (see
  [section 9](#9-operational-guide)).
- CI's `minio/minio` step has historically hit Docker Hub anonymous-pull rate
  limiting on GitHub's shared runners; a fix (optional `docker/login-action`
  + retry-with-backoff) has been written but **has not yet been confirmed
  green on a real run** - this needs a Docker Hub account/token added to the
  repo's GitHub secrets and a subsequent run watched directly. Do not infer
  CI health from local test success.
- `apps/web/Dockerfile` has been built successfully multiple times this pass
  (including the final walkthrough-fix build) but has not been deployed
  through CI as an automated build step.
- `JWT_SECRET` has no rotation mechanism that avoids a mass logout.
- Sentry is wired but not yet pointed at a real project (no DSN provisioned).

## 11. Future roadmap (not committed, ordered roughly by likely priority)

1. Platform Super Admin architecture (tenant list/search, suspend/reactivate
   a tenant, cross-tenant support tooling) - see [section 6](#6-super-admin--platform-administration-p2-not-yet-built)
   for the open design questions.
2. Structured logging + request tracing tied to the existing `x-request-id`.
3. Distributed rate limiting (Redis-backed) once running more than one API
   instance.
4. Automated frontend testing (component or e2e).
5. A CI step that builds and boot-tests both Dockerfiles, not just typechecks
   and unit-tests.
6. Confirm/upgrade Neon's backup retention window for production patient
   data; add a documented, tested restore drill.
7. `JWT_SECRET` rotation with a dual-key grace window.

## 12. Verification ledger

Everything below was checked directly during this build phase and is
reported here rather than assumed. See also [DEPLOY.md](DEPLOY.md)'s "Still
open" section, which predates and overlaps with some of these items.

| Item | Status | How verified |
|---|---|---|
| Auth audit trail (6 event types) | **Verified** | 6 real HTTP integration tests, `auth-audit.int-spec.ts` |
| Full API test suite | **Verified** | `pnpm --filter @oudhealth/api test` - 143/143 passing, 20 suites, run this pass |
| API typecheck | **Verified** | `tsc --noEmit` clean, run this pass |
| Web typecheck | **Verified** | `tsc --noEmit` clean, run this pass |
| No-Unicode-dash rule | **Verified** | `scripts/check-dashes.mjs` clean, run this pass |
| Sentry does not break API build/tests | **Verified** | existing unit tests pass unmodified with Sentry wired in, no-DSN no-op path |
| Sentry does not break web production build | **Verified** | 2+ full Docker Linux builds succeeded with the Sentry integration present |
| Final web Docker image (all 4 walkthrough fixes together) | **Verified** | full Linux build succeeded, container booted, `curl` to `/` returned HTTP 200, container logs clean (`oudhealth-web:walkthrough-final`) |
| Hospital Admin walkthrough - 4 bugs found and fixed (staff deactivate confirm, staff password-reset confirm, payment-reversal raw-prompt replaced, appointment cancel/no-show confirm) | **Verified** | manual review + fix + re-typecheck; UI behavior itself not covered by an automated test (no frontend suite exists) |
| Hospital Admin walkthrough - other flows reviewed and found correct as-is (admission discharge/transfer, admin master-data delete, claims write-off/cancel, pharmacy dispensing, patient document delete, ward bed-status toggle, settings logo removal) | **Verified as not-a-bug** | manual code review of each flow's full component, not just a keyword grep |
| Cross-tenant RLS isolation | **Verified** | automated test, `rls.int-spec.ts` |
| permissions.ts / web mirror stay in sync | **Verified** | `permissions.drift.spec.ts`, part of the 143-test suite |
| Neon point-in-time preview / restore window | **Verified** (partially - see [section 9](#9-operational-guide)) | manual test in the Neon dashboard: succeeded at ~4h back, correctly failed at ~24h back |
| CI Docker Hub fix (`docker/login-action` + retry) | **Implemented, not yet confirmed green** | code is committed (`d13e152`); no successful CI run has been observed since |
| CI overall health | **Unknown / external** | explicitly treated as a release gate the user checks directly on GitHub, not inferred from local success, per this phase's instruction |
| Structured logging | **Not started** | explicitly skipped this pass per direct instruction |
| Platform Super Admin dashboard | **Not started** | explicitly deferred to P2 per direct instruction |
| Emergency tenant deactivation | **Not started** | explicitly dropped per direct instruction |
