# Deployment

> Status: hosting target chosen - **Render**, on the **oudmed.com** domain, with
> Neon (Postgres) and Cloudflare R2 (object storage) as the two external managed
> services Render's free tier doesn't provide. `render.yaml` at the repo root is
> the blueprint. This document is the runbook to go from a fresh checkout to a
> live `https://oudmed.com` a team can log into.

## What a deploy needs (the contract)

### 1. PostgreSQL 16
- One database, **two roles**. The owner (`DATABASE_URL`) runs migrations and
  `rls.sql`. The app process connects as a second role (`APP_DATABASE_URL`) that
  is `NOSUPERUSER` and `NOBYPASSRLS` - this is what makes Row-Level Security
  real. On a managed provider you are the owner, so `pnpm db:setup-role` creates
  the second role yourself; `rls.sql` grants to it are guarded, so applying them
  before the role exists is harmless.
- Render's own free Postgres **is deleted 30 days after creation** - not viable
  for anything people will actually use. We use **Neon** instead (free, persists,
  you are the DB owner so role creation works).

### 2. S3-compatible object storage
A bucket plus access key / secret. `S3_ENDPOINT` is what the API uses;
`S3_PUBLIC_ENDPOINT` is the browser-facing host for presigned URLs, and it must
also be listed in the web app's `NEXT_PUBLIC_STORAGE_ORIGIN` (no wildcards -
`next.config.js` rejects them). Render's free tier has no persistent disk, so
self-hosting MinIO is out - we use **Cloudflare R2** (10 GB free, S3-compatible,
no egress fees).

### 3. Release steps (every deploy of the API)
`apps/api/docker-entrypoint.sh` runs them on every boot:
```
prisma migrate deploy                       # apply new migrations
prisma db execute --file prisma/rls.sql     # (re)apply RLS policies + app-role grants
node dist/main
```
Both are idempotent against an already-up-to-date database, so this is safe to
run on every restart. It does **not** seed data - see the one-time bootstrap
below.

### 4. Environment
API - see `apps/api/.env.example` for the annotated list; `render.yaml` lists
every var the API service needs. In production `validateEnv()` refuses to boot
on a placeholder `JWT_SECRET`, a missing `APP_DATABASE_URL`, or `APP_DATABASE_URL
== DATABASE_URL` (RLS would be bypassed).

Web - see `apps/web/.env.example`. `NEXT_PUBLIC_*` vars are **baked in at Docker
build time** - Render forwards a Docker service's env vars to the build as
`--build-arg` automatically, so setting them in the dashboard is enough, but
changing one requires a redeploy (not just a restart) to take effect.

### 5. Networking
The API sets CORS to the apex domain plus any subdomain of `APP_ROOT_DOMAIN`
(`apps/api/src/main.ts`). The web app is reached at `<slug>.oudmed.com` for a
hospital's workspace and bare `oudmed.com` for sign-up - this needs a wildcard
DNS record and a wildcard TLS certificate, both set up in the Render dashboard
below.

---

## Go live: Render + oudmed.com

Total external accounts needed: **Neon**, **Cloudflare** (R2), **Render**, and
DNS access to `oudmed.com`. **Resend** is optional (emails print to the Render
logs without it).

### Step 1 - Neon (Postgres)

1. Create a project at <https://neon.tech> (free plan). Note the connection
   string it gives you - it looks like
   `postgresql://<user>:<password>@<host>/<db>?sslmode=require`. This is your
   `DATABASE_URL` (owner connection).
2. Keep this tab open - you'll run the one-time bootstrap against it in Step 5,
   **before** the first Render deploy.

### Step 2 - Cloudflare R2 (object storage)

1. In the Cloudflare dashboard, create an R2 bucket, e.g. `oudhealth-prod`.
2. Create an R2 API token (Account > R2 > Manage API Tokens) with read/write
   access to that bucket. Note the **Access Key ID**, **Secret Access Key**, and
   the **S3 API endpoint** shown (`https://<account-id>.r2.cloudflarestorage.com`).
3. Enable public access for the bucket (R2 > your bucket > Settings > Public
   Access) and note the public `r2.dev` URL, or attach a custom domain
   (e.g. `files.oudmed.com`) if you want a branded file host - either works.
4. Map these to the API's S3 vars:
   - `S3_ENDPOINT` = the R2 API endpoint from step 2
   - `S3_PUBLIC_ENDPOINT` = the public `r2.dev` URL or your custom domain
   - `S3_REGION` = `auto`
   - `S3_BUCKET` = the bucket name
   - `S3_ACCESS_KEY` / `S3_SECRET_KEY` = the token from step 2
   - `S3_FORCE_PATH_STYLE` = `true`
5. The web app needs the same public host in `NEXT_PUBLIC_STORAGE_ORIGIN`.

### Step 3 - Resend (optional, for real email)

Skip this to start - leave `RESEND_API_KEY` unset and verification / password
reset links print to the API's Render logs, which is enough for a team test.
To send real email later: create a Resend account, verify sending from
`oudmed.com` (SPF/DKIM records they give you), and set `RESEND_API_KEY` +
`EMAIL_FROM="Oudmed <noreply@oudmed.com>"`.

### Step 4 - DNS at your oudmed.com registrar

Add these records now so they have time to propagate before you wire up Render's
custom domains in Step 6 (Render will tell you the exact target hostnames once
the services exist - the shapes below are what to expect):

| Record | Type | Target |
|---|---|---|
| `oudmed.com` (apex) | A / ALIAS / ANAME | the IP or hostname Render's dashboard shows for the apex domain (exact mechanics depend on your registrar - Render's Custom Domains page walks you through it) |
| `*.oudmed.com` | CNAME | `oudhealth-web.onrender.com` (your web service's Render hostname) |
| `api.oudmed.com` | CNAME | `oudhealth-api.onrender.com` (your API service's Render hostname) |

### Step 5 - One-time database bootstrap (before the first deploy)

Run this **locally**, against Neon's connection string, in this exact order -
seeding must happen before Row-Level Security policies exist, because Neon's
user is not a superuser and `FORCE ROW LEVEL SECURITY` would otherwise block the
seed's inserts (locally this is invisible because your dev Postgres user is a
superuser and bypasses RLS):

```bash
cd apps/api
export DATABASE_URL="postgresql://<neon-user>:<neon-password>@<neon-host>/<db>?sslmode=require"

pnpm exec prisma migrate deploy      # 1. schema
pnpm run seed                        # 2. demo hospital + users - BEFORE rls.sql
APP_DB_PASSWORD="<generate a strong password>" pnpm run db:setup-role   # 3. create oudhealth_app
pnpm run prisma:rls                  # 4. RLS policies + grants to oudhealth_app
```

Take the password you set in step 3 and build `APP_DATABASE_URL` by swapping
just the user and password in the same Neon connection string:
```
postgresql://oudhealth_app:<that password>@<neon-host>/<db>?sslmode=require
```
Keep both connection strings - you'll paste them into Render in Step 6.

If you ever need to re-seed later (add more demo data), do it the same way -
`pnpm run seed` against `DATABASE_URL` - it's additive and safe to re-run; it
will not be blocked by RLS because the owner role still bypasses nothing but the
seed script only inserts, which the `WITH CHECK` clause allows as long as the
row's `tenantId` matches - the seed always sets it correctly.

### Step 6 - Render blueprint

1. Push this repo (with `render.yaml`) to GitHub/GitLab if it isn't already.
2. Render dashboard -> **New** -> **Blueprint** -> pick this repo and the `main`
   branch. Render reads `render.yaml` and proposes `oudhealth-api` and
   `oudhealth-web`, both `plan: free`.
3. Apply the blueprint. Render creates both services but leaves every
   `sync: false` variable blank - fill them in per service, in
   **Dashboard -> service -> Environment**:

   **oudhealth-api**
   - `DATABASE_URL` - Neon owner connection string (Step 1)
   - `APP_DATABASE_URL` - the `oudhealth_app` connection string (Step 5)
   - `APP_DB_PASSWORD` - the password you generated in Step 5 (kept for the
     entrypoint's re-application of `rls.sql`, which regrants this role)
   - `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`,
     `S3_SECRET_KEY` - from Step 2
   - `RESEND_API_KEY` - from Step 3, or leave blank

   **oudhealth-web**
   - `NEXT_PUBLIC_STORAGE_ORIGIN` - the same public R2 host as
     `S3_PUBLIC_ENDPOINT` above

   `JWT_SECRET` and `AUTH_SECRET` are auto-generated by the blueprint
   (`generateValue: true`) - no action needed.
4. Deploy both services (saving the environment triggers this automatically).
   Watch the `oudhealth-api` logs for `prisma migrate deploy` / `applying
   rls.sql` / `starting API` - since Step 5 already brought the schema and RLS
   up to date, these should be fast no-ops.
5. **Custom domains**: on each service, Dashboard -> **Settings** -> **Custom
   Domains** -> add `api.oudmed.com` (API service) and both `oudmed.com` and
   `*.oudmed.com` (web service). Render verifies the DNS records from Step 4 and
   provisions TLS automatically (including the wildcard cert) - this can take a
   few minutes to a few hours depending on DNS propagation.

### Step 7 - Verify

- `https://api.oudmed.com/api/health` -> `{"status":"ok","service":"oudhealth-api",...}`.
- `https://oudmed.com` -> the apex sign-up page.
- `https://demo.oudmed.com/login` -> the seeded demo hospital's login. Log in
  with `admin@demo.com` / `Admin1234!` (from the Step 5 seed).
- Upload a file (e.g. a patient document) and confirm it renders - proves R2 is
  wired correctly on both API and web.
- If `RESEND_API_KEY` is unset, trigger "forgot password" and check the API
  service logs for the printed reset link.

### Free-tier caveats to set expectations with the team

- Both services **spin down after 15 minutes idle** and take ~30-60s to wake up
  on the next request - the first login after a quiet period will feel slow.
  Render's paid "Starter" tier ($7/mo/service) removes this if it becomes
  annoying during testing.
- Free instance-hours (750/month per workspace) are shared across free
  services - fine for two services that both sleep, but worth knowing.
- Neon's free tier also idles its compute after inactivity with a similar
  cold-start; the data itself does not expire (unlike Render's free Postgres).

---

## Still open (not blockers for a pilot, needed before scale)

- Distributed rate limiting - `@nestjs/throttler` is in-memory per instance, so
  more than one API replica multiplies the limit. Wire it to a shared store
  (Redis) when scaling out.
- Error tracking (Sentry), metrics, structured request logging.
- Automated backups + a tested restore (Neon has point-in-time restore on paid
  plans - confirm the window covers your risk tolerance before real patient
  data).
- `JWT_SECRET` rotation without mass logout (dual-key grace window).
- A `docker build` smoke step in CI. `apps/api/Dockerfile` is verified end to
  end (build, boot against a real Postgres + S3, `/api/health/ready` green -
  three real bugs found and fixed this way: pnpm's `--legacy` deploy flag,
  `prisma` needing to be a runtime dependency not a devDependency since
  `docker-entrypoint.sh` runs it at boot, `apk add openssl` for Prisma's
  engine on musl, and the `dist/apps/api/src` COPY path). `apps/web/Dockerfile`
  has not completed a full build end to end - see its own header comment.
