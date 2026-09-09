# OudMed HMS

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

## Local setup

Everything runs on your machine. Docker provides only Postgres and MinIO; the API
and web apps run from source.

### Prerequisites

| Tool           | Version | Install                                                            |
| -------------- | ------- | ------------------------------------------------------------------ |
| Node.js        | 20.x    | <https://nodejs.org> (or `nvm install 20`)                         |
| pnpm           | 11.7    | `corepack enable` (ships with Node 20) - the repo pins the version |
| Docker Desktop | current | must be **running** before you start                               |

Plus a Chromium browser (Chrome / Edge / Brave) or Firefox. Safari needs one extra
line in `/etc/hosts` (see [Logging in](#logging-in)).

### Fast path (one command)

```bash
git clone <repo-url> oudhealth
cd oudhealth

./scripts/setup.sh          # macOS / Linux / Git Bash on Windows
#   Windows PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

The script checks your tools, installs dependencies, starts Docker, creates the
`.env` files from the examples, runs migrations + Row-Level Security, and seeds a
demo hospital (only if the database is empty - `RESEED=1 ./scripts/setup.sh` to
force). Then start the two dev servers:

```bash
pnpm --filter @oudhealth/api run dev     # http://localhost:3000  (Swagger at /docs)
pnpm --filter @oudhealth/web run dev     # http://localhost:3001
```

### Manual path

If you would rather run each step, or the script fails partway:

```bash
# 1. dependencies
corepack enable
pnpm install

# 2. env files - the defaults match the Docker setup, no edits needed
cp apps/api/.env.example  apps/api/.env
cp apps/web/.env.example  apps/web/.env.local
#   Windows PowerShell: copy apps\api\.env.example apps\api\.env  (etc.)

# 3. backing services (Postgres :5432, MinIO :9000 / console :9001)
docker compose up -d
docker compose ps            # wait until db + minio are "healthy"

# 4. database
pnpm --filter @oudhealth/api exec prisma migrate deploy   # apply schema
pnpm --filter @oudhealth/api run prisma:rls               # RLS policies + app-role grants
pnpm --filter @oudhealth/api run seed                     # demo hospital + users

# 5. run it (two terminals, from the repo root)
pnpm --filter @oudhealth/api run dev
pnpm --filter @oudhealth/web run dev
```

`docker compose` creates the non-superuser `oudhealth_app` role for you
(`docker/postgres-init/01-app-role.sql`), so `pnpm run db:setup-role` is **not**
needed locally - it is only for a managed database. The owner connection
(`DATABASE_URL`) runs migrations, seed and `prisma:rls`; the API process connects
as `oudhealth_app` (`APP_DATABASE_URL`, NOSUPERUSER / NOBYPASSRLS) so RLS is
actually enforced.

### Logging in

Open **<http://demo.localhost:3001>** - note the `demo.` subdomain. The bare
`localhost:3001` is the apex (new-hospital sign-up only); a hospital workspace
lives at `<slug>.localhost:3001`.

| Role           | Email                | Password     |
| -------------- | -------------------- | ------------ |
| Hospital admin | `admin@demo.com`     | `Admin1234!` |
| Receptionist   | `reception@demo.com` | `Password1`  |
| Nurse          | `nurse@demo.com`     | `Password1`  |
| Doctor         | `j.jumbo@demo.com`   | `Password1`  |
| Pharmacist     | `pharmacy@demo.com`  | `Password1`  |
| Lab staff      | `lab@demo.com`       | `Password1`  |
| Accountant     | `accounts@demo.com`  | `Password1`  |

Chrome, Edge and Firefox resolve `*.localhost` automatically. **Safari** does not:
add `127.0.0.1 demo.localhost` to `/etc/hosts` first.

Verification and password-reset emails are printed to the API console in dev
(leave `RESEND_API_KEY` blank).

### Reset / troubleshooting

| Symptom                                                   | Fix                                                                                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Want a clean slate                                        | `docker compose down -v` then re-run setup                                                                                                                                              |
| API exits with an env error                               | check `apps/api/.env` exists and Docker is up                                                                                                                                           |
| `password authentication failed for user "oudhealth_app"` | `apps/api/.env` `APP_DATABASE_URL` password must match `docker/postgres-init/01-app-role.sql` (`oudhealth-app-dev`); or the volume is stale - `docker compose down -v` and re-run setup |
| Port 3000/3001/5432/9000 in use                           | stop the other process, or change `PORT` / the compose port maps                                                                                                                        |
| `demo.localhost` will not load                            | not on Chromium/Firefox, or Safari without the `/etc/hosts` line                                                                                                                        |

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
Any new tenant table must be added to the `FOREACH` list in
`apps/api/prisma/rls.sql`, then `cd apps/api && pnpm run db:sync` (that is
`prisma generate && pnpm run prisma:rls`, which also re-grants the app role). A
table without an RLS policy is a cross-tenant data leak.

## Deployment

See [docs/DEPLOY.md](docs/DEPLOY.md). A hosting target has not been finalised; the
Dockerfiles in `apps/*/Dockerfile` are structurally complete but not yet built in
CI.
