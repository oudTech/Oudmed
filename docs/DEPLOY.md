# Deployment

> Status: a hosting target has not been finalised. The Dockerfiles in
> `apps/api/Dockerfile` and `apps/web/Dockerfile` are structurally complete for
> the pnpm monorepo but have **not been built in CI yet** - build and run them
> locally before a first deploy. This document is the contract a deploy must
> satisfy, plus the options.

## What a deploy needs

### 1. PostgreSQL 16
- One database.
- **Two roles.** The owner (`DATABASE_URL`) runs migrations and `rls.sql`. The
  app process connects as a second role (`APP_DATABASE_URL`) that is
  `NOSUPERUSER` and `NOBYPASSRLS` - this is what makes Row-Level Security real.
  On a managed provider you create this role once by hand; `rls.sql` grants to it
  are guarded, so applying them before the role exists is harmless.
- Backups / PITR: not configured. Decide before real patient data.

### 2. S3-compatible object storage
A bucket plus access key / secret. Set `S3_ENDPOINT` (what the API uses) and
`S3_PUBLIC_ENDPOINT` (the browser-facing host for presigned URLs). Add the public
host to the web app's `NEXT_PUBLIC_STORAGE_ORIGIN` (no wildcards - `next.config.js`
rejects them).

### 3. Release steps (every deploy of the API)
`apps/api/docker-entrypoint.sh` runs them:
```
prisma migrate deploy                       # apply new migrations
prisma db execute --file prisma/rls.sql     # (re)apply RLS policies + app-role grants
node dist/main
```
If you deploy without that entrypoint (a PaaS "release command", a K8s init
container), you must run the first two yourself.

### 4. Environment

API - see `apps/api/.env.example` for the annotated list. Required:
`DATABASE_URL`, `APP_DATABASE_URL`, `JWT_SECRET` (32+ random chars),
`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. In production
`validateEnv()` also expects `APP_ROOT_DOMAIN`, `APP_PROTOCOL=https`,
`FRONTEND_URL`, and refuses to boot on a placeholder `JWT_SECRET` or a missing
`APP_DATABASE_URL`. `RESEND_API_KEY` for real email. `CLAMAV_HOST` to enable
upload malware scanning. `ENABLE_SWAGGER=true` only if `/docs` should be exposed
(put it behind an authenticated gateway).

Web - see `apps/web/.env.example`. Runtime: `AUTH_SECRET`, `INTERNAL_API_URL`
(server-to-server), the `NEXT_PUBLIC_*` domain vars. Note: `NEXT_PUBLIC_*` are
**baked at build time**, so a web image is tied to one environment - build a
separate image per environment, or move to Next's runtime-env pattern first.

### 5. Networking
The API sets a global `/api` prefix and CORS to the apex domain plus any
subdomain of `APP_ROOT_DOMAIN`. The web app expects to be reached at
`<slug>.<root-domain>` for tenant workspaces and the bare root for sign-up, so
you need a wildcard DNS record and a wildcard TLS certificate.

## Options for the hosting target

| Option | Fit | Cost of ownership |
|---|---|---|
| **PaaS** (Render, Railway, Fly.io) | Fastest to a live URL. Managed Postgres with a second role, build-from-Dockerfile, release command, secrets UI, wildcard domains + certs. | Low. Recommended for the pilot. |
| **Registry + VPS/compose** | One box, `docker compose` with the built images, Caddy/Traefik for wildcard TLS, a managed or self-run Postgres. | Medium. You own patching, backups, TLS renewal. |
| **Kubernetes** | Only if a cluster already exists. Deployment per app, an init container for the release steps, secrets via a manager, cert-manager for wildcard TLS. | High. |

**Recommendation:** a PaaS for the pilot hospital. Managed Postgres (create the
`oudhealth_app` role once), the API as a Docker service with the release command
pointed at `docker-entrypoint.sh`, the web as a second service built per
environment, an S3 bucket (the PaaS's or R2), and `RESEND_API_KEY` for email.
Revisit when multi-region or data-residency requirements land.

## Still open (not blockers for a pilot, needed before scale)

- Distributed rate limiting - `@nestjs/throttler` is in-memory per instance, so
  more than one API replica multiplies the limit. Wire it to a shared store
  (Redis) when scaling out.
- Error tracking (Sentry), metrics, structured request logging.
- Automated backups + a tested restore.
- `JWT_SECRET` rotation without mass logout (dual-key grace window).
- A `docker build` smoke step in CI once a target is chosen.
