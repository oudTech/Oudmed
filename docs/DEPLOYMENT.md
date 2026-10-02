# Production Deployment

> **This is the production runbook: web on Fly.io, API on Render, database on
> a NEW Neon project.** The database you have used all along (Neon, currently
> referenced throughout `docs/DEPLOY.md`) becomes **staging** from this point
> on - do not point production at it. `docs/DEPLOY.md` describes the older
> all-Render topology and the staging environment; this document supersedes it
> for production.
>
> Read this whole document before running anything. Steps that need you to
> create an account, pick a password, or make a business decision are marked
> **YOU DO THIS** - Claude cannot create third-party accounts, buy domains, or
> hold production secrets.

## Contents

1. [Environment variables](#1-environment-variables)
2. [Fly.io (web)](#2-flyio-web)
3. [Render (API)](#3-render-api)
4. [New Neon production database](#4-new-neon-production-database)
5. [First-run setup](#5-first-run-setup)
6. [Email (Resend)](#6-email-resend)
7. [Sentry](#7-sentry)
8. [Backups and the restore drill](#8-backups-and-the-restore-drill)
9. [Go-live checklist](#9-go-live-checklist)
10. [Rollback plan](#10-rollback-plan)

---

## 1. Environment variables

Full annotated templates: `apps/api/.env.production.example` and
`apps/web/.env.production.example` (new files, added alongside this
document). Summary tables below - "Required" means the API/web app will not
boot or will misbehave without it; "Regenerate" means **do not reuse the
value from staging or dev** - create a fresh one for production.

### API (Render)

| Var | Required | Regenerate | Source |
|---|---|---|---|
| `NODE_ENV` | yes | - | literal `production` |
| `DATABASE_URL` | yes | yes (new project) | Neon production project, owner connection |
| `APP_DATABASE_URL` | yes | yes (new project) | Neon production project, `oudhealth_app` role (Section 4) |
| `APP_DB_PASSWORD` | yes | **yes** | a strong random password you generate |
| `JWT_SECRET` | yes | **yes** | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PORT` | yes | - | `3000` |
| `ENABLE_SWAGGER` | no | - | `false` |
| `APP_ROOT_DOMAIN` | yes | - | `oudmed.com` |
| `APP_PROTOCOL` | yes | - | `https` |
| `FRONTEND_URL` | yes | - | `https://oudmed.com` |
| `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_BUCKET_ENDPOINT` | yes | yes (new bucket) | Cloudflare R2 production bucket (Section 2 of `docs/DEPLOY.md` still applies - just make a second, production bucket) |
| `FILE_MAX_MB` | no | - | `20` |
| `RESEND_API_KEY`, `EMAIL_FROM` | recommended | yes (new domain/key) | Section 6 |
| `SENTRY_DSN` | no | yes (new project) | Section 7 |
| `TURNSTILE_SECRET_KEY`, `CONTACT_INQUIRY_TO` | yes | can reuse if the contact form is shared across environments | Cloudflare Turnstile dashboard |
| `CLAMAV_HOST` | no | - | leave blank (no reachable clamd host for the pilot) |
| `PAYSTACK_*` | no | - | leave blank at launch; bank transfer still works (Part 6) |

### Web (Fly.io)

| Var | Required | Regenerate | Source |
|---|---|---|---|
| `AUTH_SECRET` | yes | **yes** | same `randomBytes(32)` command as above, a different value |
| `PORT` | yes | - | `3001` |
| `INTERNAL_API_URL`, `NEXT_PUBLIC_API_URL` | yes | - | `https://api.oudmed.com/api` |
| `NEXT_PUBLIC_ROOT_DOMAIN` | yes | - | `oudmed.com` |
| `NEXT_PUBLIC_APP_PROTOCOL` | yes | - | `https` |
| `NEXT_PUBLIC_STORAGE_ORIGIN` | yes | yes (new bucket) | the R2 production bucket's public host |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | no | yes (new project) | Section 7 |
| `TURNSTILE_SITE_KEY` | yes | can reuse with the API's secret key | Cloudflare Turnstile dashboard |

`NEXT_PUBLIC_*` values are baked into the JavaScript bundle at **Docker build
time** (`fly.toml`'s `[build.args]`, passed with `--build-arg` - see the
Dockerfile header). Changing one later needs a rebuild and redeploy, not a
restart. Everything else on Fly is a runtime secret
(`fly secrets set NAME=value`), never committed to `fly.toml`.

---

## 2. Fly.io (web)

`fly.toml` and `apps/web/Dockerfile` already exist and are configured for
this. What's confirmed vs. still open:

- **Health check**: the Dockerfile's `HEALTHCHECK` hits
  `GET /api/auth/providers` on `127.0.0.1:3001` - this is a container-level
  Docker healthcheck, separate from Fly's own HTTP service checks
  (`[http_service]` in `fly.toml`, which currently has none declared
  explicitly beyond the implicit TCP check). Add an explicit
  `[[http_service.checks]]` block hitting the same path if you want Fly's own
  routing layer to stop sending traffic to an unhealthy machine, not just
  Docker's internal health status.
- **Build verification**: I ran `next build` directly and it compiles and
  generates all 41 pages cleanly - the code is sound. A real `docker build -f
  apps/web/Dockerfile ...` attempt in this session hung for 30 minutes during
  `pnpm install` with no output and had to be killed - almost certainly a
  local network/registry-throttling issue (the Dockerfile's own header
  already warns this can happen pulling Next.js's per-platform SWC binaries
  on a slow connection), not a defect in the Dockerfile itself. **Treat the
  first `fly deploy` as the real test** - Fly builds remotely on its own
  infrastructure, which does not share whatever constrained this machine's
  attempt. If it fails, the error will be in `fly deploy`'s own output;
  come back here with that error rather than assuming the Dockerfile is
  broken.
- **Wildcard subdomains**: Fly.io's managed TLS certificates do **not**
  support wildcards directly the way Render's dashboard does. The practical
  path:
  1. `fly certs add oudmed.com`
  2. `fly certs add "*.oudmed.com"` - Fly's own docs confirm wildcard certs
     are supported via ACME DNS-01 challenge, which needs a `TXT` record
     added manually (Fly prints the exact record to add when you run this;
     it is not automatic the way the apex HTTP-01 challenge is).
  3. **YOU DO THIS** - at your DNS registrar for `oudmed.com`, add:

     | Record | Type | Target |
     |---|---|---|
     | `oudmed.com` (apex) | A / AAAA | the IPv4/IPv6 Fly prints after `fly ips allocate-v4` / `allocate-v6` (or use Fly's anycast `A`/`AAAA` if on a plan that supports it - `fly certs show oudmed.com` tells you what's pending) |
     | `*.oudmed.com` | CNAME | `oudhealth.fly.dev` (your Fly app's default hostname) |
     | `_acme-challenge.oudmed.com` (or whatever `fly certs add` prints) | TXT | the value `fly certs add "*.oudmed.com"` gives you, for the DNS-01 wildcard challenge |
  4. Run `fly certs check oudmed.com` and `fly certs check "*.oudmed.com"`
     until both report `Ready` - this can take minutes to a few hours
     depending on DNS propagation and CA validation.
- **Sleep behavior**: `fly.toml` already sets `auto_stop_machines = false`,
  `auto_start_machines = true`, `min_machines_running = 1` - the web app
  **never sleeps**, unlike Render's free tier. No cold-start concern for web.
  Cost implication: this keeps at least one `shared-cpu-1x, 1gb` machine
  billed continuously (Fly's free allowance covers a small amount of this;
  confirm current pricing before launch).

---

## 3. Render (API)

- `render.yaml` updated this session: it now declares **only** `oudhealth-api`
  (the leftover `oudhealth-web` service from an earlier all-Render plan has
  been removed - web is Fly now) and the plan changed from `free` to
  `starter`.
- **Why not `free`**: confirmed in Part 1 - the nightly bed-charge job and
  the three subscription-renewal crons are plain in-process `@nestjs/schedule`
  jobs. They only fire while the Node process is alive. Render's free tier
  spins the instance down after 15 minutes idle; if that happens to overlap
  00:05 Africa/Lagos (the bed-charge job) or 06:00-08:00 UTC (the renewal
  jobs), that day's run is silently skipped. The bed-charge job self-heals
  (a missed night is caught up at the next run or at discharge, before any
  bill is finalized - confirmed by reading `bed-charges.service.ts`), but
  this is exactly the kind of thing that should not be relied on from day
  one. **Render's `starter` plan ($7/mo at time of writing) removes the sleep
  entirely** - this is the minimum recommended for production.
- **Build/start**: `dockerfilePath: apps/api/Dockerfile`, which has its own
  `docker-entrypoint.sh` running `prisma migrate deploy` then
  `prisma db execute --file prisma/rls.sql` then `node dist/main` on every
  boot - safe to run on every deploy and every restart (both steps are
  idempotent against an already-current database, confirmed in Part 1 by
  running them against a fresh empty database).
- **Health check**: `healthCheckPath: /api/health` (liveness only - process
  up, no dependency checks). `/api/health/ready` also exists (checks database
  + object storage reachability) but is deliberately **not** wired as
  Render's own routing health check - a transient DB blip would otherwise
  pull the instance out of rotation on top of the DB problem itself. Use
  `/api/health/ready` manually when debugging, not as the routing probe.
- **CORS**: already locked to `APP_ROOT_DOMAIN` + any subdomain
  (`apps/api/src/main.ts`), not `*` - no change needed, just confirm
  `APP_ROOT_DOMAIN=oudmed.com` is actually set on the Render service.

---

## 4. New Neon production database

**YOU DO THIS** (account/billing decisions), with exact steps:

1. <https://neon.tech> -> **New project**. Name it clearly, e.g.
   `oudhealth-production` - do **not** reuse or rename the existing project
   (that one is staging now).
2. Pick a plan with a point-in-time-restore window you're comfortable with
   (at least 7 days recommended for real patient/billing data - the existing
   staging project was upgraded for this reason; match or exceed it for
   production). Note the connection string - this is `DATABASE_URL`.
3. **Settings -> Backup/Restore** (or **Branches -> History**): set the
   history retention window to **the maximum the plan allows**. This only
   starts counting from when you set it, so do this immediately, before any
   real data exists.
4. Enable 2FA on the Neon account that owns this project (Account settings ->
   Security) if not already on. Confirm who else has project access and
   remove anyone who shouldn't.
5. If the plan offers branch protection on the production branch, turn it on.
6. Run migrations against it (owner connection, from your own machine or CI,
   **never** from a committed file):
   ```bash
   cd apps/api
   DATABASE_URL="<neon production owner connection string>" pnpm exec prisma migrate deploy
   ```
7. Create the `oudhealth_app` role (non-superuser, `NOBYPASSRLS`) and apply
   RLS, in that order - **do this before the first Render deploy**, since
   `docker-entrypoint.sh`'s `rls.sql` grants are silently skipped if the role
   doesn't exist yet:
   ```bash
   DATABASE_URL="<neon production owner connection string>" \
   APP_DB_PASSWORD="<generate a strong password>" \
     pnpm run db:setup-role
   DATABASE_URL="<neon production owner connection string>" \
     pnpm run prisma:rls
   ```
8. Build `APP_DATABASE_URL` by swapping just the user and password into the
   same connection string:
   ```
   postgresql://oudhealth_app:<password from step 7>@<neon-host>/<db>?sslmode=require
   ```
9. Paste `DATABASE_URL`, `APP_DATABASE_URL`, `APP_DB_PASSWORD` into the
   Render service's Environment tab (all three are `sync: false` in
   `render.yaml`, so Render leaves them blank until you do).

No seed data goes into this database - production starts genuinely empty
(unlike the staging bootstrap in `docs/DEPLOY.md`, which seeds a demo
hospital). The first real hospital is created through the normal sign-up
flow, Section 5.

---

## 5. First-run setup

### Super Admin (platform operator) account

```bash
cd apps/api
DATABASE_URL="<neon production owner connection string>" \
PLATFORM_USER_EMAIL="you@oudmed.com" \
PLATFORM_USER_PASSWORD="<a strong password, 12+ chars>" \
PLATFORM_USER_NAME="Your Name" \
  pnpm create-platform-user
```
Safe to re-run - an existing email just gets its password/name updated. This
account logs into the platform admin console (`PlatformAuthGuard`-gated
routes), not any hospital's workspace.

### The hospital and its first Hospital Admin

There is no CLI script for this by design - it goes through the same
self-serve flow a real customer would use, which is also the best first
smoke test of production:

1. Visit `https://oudmed.com` (the apex) and start the "new hospital" sign-up.
2. Enter the hospital name, choose a subdomain slug, enter the first admin's
   email.
3. Check the inbox for the 6-digit verification code (by design, not a
   magic link - see memory `project_auth_overhaul`) and enter it.
4. Set a password. This creates the `Tenant` row and the first `User` with
   role `HOSPITAL_ADMIN`, and logs them in at `https://<slug>.oudmed.com`.

### What the Hospital Admin must configure before staff start using it

Walk through `/settings` and `/admin` in this order - clinical/billing
features silently produce wrong numbers (not errors) if these are skipped:

1. **Hospital profile & branding** (`/settings`) - name, address, logo,
   invoice/receipt number prefixes.
2. **Departments** (`/admin`) - at least one, before staff can be assigned.
3. **Service catalogue** (`/admin` -> Services) - every billable
   consultation/procedure/lab/imaging item and its price. Nothing bills
   correctly without this.
4. **Drug catalogue with sell prices** (`/pharmacy` -> Inventory) - dispensing
   is blocked for any drug with no catalogue price set (FUNC-1 price
   integrity, deliberate).
5. **Wards and bed rates** (`/wards`, if the hospital admits inpatients) -
   `dailyRate`/`dayCaseRate` per ward; a ward with no rate silently holds bed
   charges rather than posting a wrong price (confirmed in `bed-charges.ts`).
6. **Insurance providers** (`/admin` -> Insurance) - name, co-pay percentage,
   for every HMO the hospital works with.
7. **Staff accounts** (`/hr`) - create accounts for reception, nurses,
   doctors, pharmacist, lab staff, accountant as needed; the admin sets each
   person's initial password directly (no invite email).
8. **Settings toggles** (`/settings`) - `inpatientChargeRule`,
   `shortStayChargeMode`, `requireSettledBillAtDischarge`,
   `requirePaymentBeforeDispense` - all default to the safest/most permissive
   option (off), confirm each one matches how this specific hospital actually
   wants to operate before go-live, not after.

---

## 6. Email (Resend)

1. **YOU DO THIS**: create a Resend account, add `oudmed.com` as a sending
   domain (Resend dashboard -> Domains -> Add Domain).
2. Resend gives you SPF, DKIM (and optionally DMARC) DNS records - add them
   at your registrar. Verification typically completes within minutes to a
   few hours.
3. Once verified, create an API key and set `RESEND_API_KEY` +
   `EMAIL_FROM="Oudmed <noreply@oudmed.com>"` on the Render API service.
4. **Test before go-live**: trigger a real password-reset and a new-hospital
   verification-code email (Section 5's sign-up flow does the second one for
   free) and confirm both arrive, not just that the API call succeeded - a
   misconfigured SPF/DKIM record can cause silent spam-folder delivery or
   provider-side rejection that Resend's own API still reports as "sent."

If `RESEND_API_KEY` is left unset, both email types print their content
(including the verification code / reset link) to the Render service logs
instead of sending - useful for a dry run, not acceptable once a real
hospital is live and staff expect real email.

---

## 7. Sentry

1. **YOU DO THIS**: create two Sentry projects (or one project with two
   environments tagged `production` - either works, two projects keeps
   staging/production error streams fully separate, which is simpler to
   reason about for a first pilot).
2. Copy the DSN into `SENTRY_DSN` on the Render API service and both
   `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` on the Fly web app (same DSN value
   for both web vars - they're two env vars only because of when each is
   read, per the existing `.env.example` comments).
3. **Privacy scrubbing is already active** (confirmed by reading
   `apps/api/src/common/sentry.ts` and the web equivalent) -
   `sendDefaultPii: false` plus a `beforeSend` hook that strips PII and tags
   only tenant/user/role, not patient data. No action needed beyond setting
   the DSN; this was built and verified earlier in this project's hardening
   work.
4. Trigger one real error after deploy (e.g., a deliberately malformed
   request) and confirm it shows up in the Sentry project with the scrubbing
   intact - a DSN typo fails silently (errors just don't show up, no boot
   error), so this is worth the two minutes.

---

## 8. Backups and the restore drill

Same mechanism `docs/OPERATIONS_GUIDE.md` already documents and that was
validated against the (now-staging) Neon project - repeat it against the
**new production project**, since a drill against staging proves nothing
about production's own retention window/branch setup.

1. Confirm Section 4 steps 2-3 are done (retention window at plan maximum)
   **before** running the drill - the drill proves whatever window is
   currently configured, not the window you intend to configure later.
2. **Drill 1, immediately after setup, before the hospital enters real
   data**:
   ```bash
   cd apps/api
   DATABASE_URL="<neon production owner connection string>" pnpm dr-drill plant
   # record the printed id/label/createdAt
   # wait a few minutes
   DATABASE_URL="<neon production owner connection string>" pnpm dr-drill clear <id>
   # record the exact "Cleared marker ... at ..." timestamp
   ```
   In the Neon dashboard, create a new branch restored to a few seconds
   before that timestamp, point a scratch local `.env` at the new branch's
   connection string, and run `pnpm dr-drill check <id>` - confirm `FOUND`.
   Delete the scratch branch once confirmed. Record the timing in the drill
   log below.
3. **Drill 2, at least 24 hours after drill 1**: identical steps, but restore
   to a point ~24 hours back - this is the window that specifically matters
   for a real incident discovered a day late, and the one that would have
   failed on a shorter-retention plan.
4. Fill in the same drill log table `docs/OPERATIONS_GUIDE.md` already has,
   duplicated here for the production project specifically:

   | Drill | Date | Marker cleared at | Branch restored to | Time to confirm restored data | Result |
   |---|---|---|---|---|---|
   | 1 (short interval, production) | _pending_ | | | | |
   | 2 (~24h back, production) | _pending_ | | | | |

5. The full real-incident restore procedure (when to restore vs. fix
   forward, how to repoint Render without touching the database in place,
   who to contact) is already written in `docs/OPERATIONS_GUIDE.md`'s
   "Restore procedure" section and applies unchanged to production - just
   substitute the production project/service names.

---

## 9. Go-live checklist

Run in order. Each step assumes the previous one succeeded.

1. [ ] Neon production project created, retention window set to max (Section 4, steps 1-3)
2. [ ] Migrations applied, `oudhealth_app` role created, RLS applied (Section 4, steps 6-8) - **before** the first Render deploy
3. [ ] Cloudflare R2 production bucket created, public access enabled (same steps as `docs/DEPLOY.md` Step 2, new bucket)
4. [ ] Resend domain verified, test email received (Section 6)
5. [ ] Sentry projects created, DSNs noted (Section 7)
6. [ ] Render: `render.yaml` blueprint applied, every `sync: false` var filled in, plan confirmed `starter` or above
7. [ ] Render: first deploy green, `https://api.oudmed.com/api/health` returns `{"status":"ok",...}`
8. [ ] `https://api.oudmed.com/api/health/ready` returns 200 (database + storage both reachable)
9. [ ] DNS records added for Fly (apex + wildcard CNAME + ACME TXT challenge, Section 2)
10. [ ] Fly: `fly deploy` succeeds (the real build test - see Section 2's note on the local build attempt)
11. [ ] Fly: `fly certs check` reports `Ready` for both `oudmed.com` and `*.oudmed.com`
12. [ ] `https://oudmed.com` loads the apex sign-up page
13. [ ] Super Admin account created (Section 5)
14. [ ] First hospital created via real sign-up flow, verification email received, login works at `https://<slug>.oudmed.com` (Section 5)
15. [ ] Hospital Admin configuration checklist complete (Section 5's eight items) before staff accounts are created
16. [ ] Backup drill 1 run and confirmed (Section 8) - **before** any real patient data is entered
17. [ ] **10-minute smoke test**, one pass per role, on the real production domain:
    - [ ] Log in as Hospital Admin, Receptionist, Nurse, Doctor, Pharmacist, Accountant (each their own account from the HR setup)
    - [ ] Register a patient
    - [ ] Book an appointment, check in
    - [ ] Record vitals
    - [ ] Record a diagnosis, write a prescription, place a lab order
    - [ ] Dispense the prescription
    - [ ] Confirm an invoice was created for the visit
    - [ ] Record a payment against it
    - [ ] Admit a patient (if the hospital does inpatient care), confirm a bed shows occupied
    - [ ] Discharge that patient, confirm the final bill is correct
18. [ ] Backup drill 2 run and confirmed, ~24h after drill 1 (Section 8)

Hospital staff start using the system for real only after steps 1-17 are
complete; drill 2 can trail by a day per the user's own instruction, but
nothing here blocks on it except the final "fully done" mark.

---

## 10. Rollback plan

**A bad deploy (code problem, no data corruption) - fix forward:**
1. Render: Dashboard -> service -> **Deploys** -> find the last known-good
   deploy -> **Redeploy**. This is faster and safer than attempting a
   same-session fix under pressure.
2. Fly: `fly releases` lists prior releases; `fly deploy --image <prior image
   ref>` (or the Fly dashboard's rollback action) returns to the last known
   good one.
3. Confirm `/api/health/ready` and a real login both work post-rollback
   before declaring it resolved.

**Bad data (a destructive bug, accidental bulk change) - restore, don't
fix rows by hand:**
Follow `docs/OPERATIONS_GUIDE.md`'s "Restore procedure" section exactly
(branch-from-point-in-time on the production Neon project, repoint Render's
`DATABASE_URL`/`APP_DATABASE_URL` to the new branch, redeploy, verify) - do
not use Neon's destructive "Restore" action on the live branch; always branch
first.

**Either way:**
- Post a plain-language status update for the hospital: what's affected,
  that it's being worked on, an honest time estimate (refined once the
  backup-drill timings above give you a real number instead of a guess).
- Do not attempt a database restore as the first response to a pure
  application bug with no data corruption - it loses every write since the
  restore point for no benefit when fixing forward would have resolved it
  cleanly.
