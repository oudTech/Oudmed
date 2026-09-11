# Technology Stack

## API (`apps/api`)
| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS | required by `pnpm@11.7.0` (pinned in `package.json`) |
| Language | TypeScript 5 | |
| Framework | NestJS 10 | module per HMS area |
| ORM | Prisma 5 | type-safe queries, incremental migrations |
| Database | PostgreSQL 16 | transactions + Row-Level Security for tenant isolation |
| Auth | in-house | per-tenant `User`, bcrypt password hash, JWT signed with `JWT_SECRET`, email verification via Resend |
| Validation | class-validator + class-transformer | global `ValidationPipe` |
| API docs | Swagger (`@nestjs/swagger`) | `/docs`; off in production unless `ENABLE_SWAGGER=true` |
| Rate limiting | `@nestjs/throttler` | in-memory, per instance |
| Tests | Jest | integration specs hit a real Postgres + MinIO |

## Web (`apps/web`)
| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) | RSC only for the two auth-gate layouts; everything else `'use client'` |
| Language | TypeScript 5 | shares `@oudhealth/contracts` types with the API |
| Styling | Tailwind CSS | brand accent is the `primary` token (`var(--brand-primary)`, themed per tenant) |
| Server state | TanStack Query | all server state; `useQuery` / `useMutation` / `invalidateQueries` |
| HTTP | Axios | singleton with a bearer-token setter and a 401 interceptor |
| Auth | NextAuth v5 (credentials) | subdomain-aware; `trustHost` on |
| Forms | mostly hand-rolled `useState`; the patient registration wizard uses React Hook Form + Zod (`@oudhealth/validation`) | |

## Storage
S3-compatible object storage. MinIO in dev (`docker compose`); any S3 / R2 /
Spaces bucket in production. Uploads are magic-byte checked, optionally malware
scanned (clamd, opt-in via `CLAMAV_HOST`), and served through short-lived
presigned URLs.

## Monorepo
Turborepo + pnpm workspaces. `packages/contracts` (type-only interfaces),
`packages/validation` (Zod schemas for the web), `packages/config` (shared
tsconfig). `apps/web` transpiles both packages; `apps/api` consumes `contracts`
as `import type` only.

## Infrastructure
| Layer | Status |
|---|---|
| Dev services | Docker Compose: Postgres + MinIO |
| CI | GitHub Actions (`.github/workflows/ci.yml`): install, dash scan, typecheck, web build, migrate + RLS, API test suite |
| Container images | `apps/*/Dockerfile` (structurally complete, not yet built in CI) |
| Hosting / secrets / observability | not chosen yet, see [DEPLOY.md](DEPLOY.md) |

## Multi-tenancy model
Shared database, shared schema, every tenant-scoped row carries `tenantId`, with
PostgreSQL Row-Level Security enforcing isolation at the database layer. The API
connects as a NOSUPERUSER / NOBYPASSRLS role (`APP_DATABASE_URL`) so the policies
are always in force. Enterprise customers could later move to a dedicated
database.
