# syntax=docker/dockerfile:1
#
# STATUS: verified 2026-09-11 - builds, boots against a real Postgres + S3,
# runs migrations/RLS on startup, and /api/health/ready reports both checks ok.
# Not yet wired into CI (see docs/DEPLOY.md "Still open").
#
# Build from the REPO ROOT:
#   docker build -f apps/api/Dockerfile -t oudhealth-api .

FROM node:22-alpine AS base
# Prisma's query/schema engine binaries need a real OpenSSL on musl (Alpine) -
# without it they fail to even start ("Could not parse schema engine response").
# Needed in every stage that touches Prisma: `prisma generate` (build) and
# `prisma migrate deploy` / `rls.sql` (runtime, via docker-entrypoint.sh).
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /repo

# ---- deps: whole workspace, against the frozen lockfile ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/validation/package.json packages/validation/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile

# ---- build: prisma generate + nest build, then prune to prod deps ----
FROM deps AS build
COPY . .
# --legacy: pnpm 10+'s default `deploy` requires workspace:* deps to be marked
# "injected" (dependenciesMeta) to be copied rather than symlinked. Not needed
# here - @oudhealth/contracts is a type-only devDependency (erased by `tsc`,
# never present in dist/), so the legacy deploy behavior (skip it, like any
# other devDependency under --prod) is exactly what we want.
RUN pnpm --filter @oudhealth/api exec prisma generate \
 && pnpm --filter @oudhealth/api run build \
 && pnpm --filter @oudhealth/api --prod deploy /app --legacy

# ---- runner ----
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
# tsc has no explicit rootDir, and `@oudhealth/contracts` gets pulled into the
# compiled program (for types only - never a runtime import), so its implicit
# common-root computation nests the real app output under apps/api/src/. Take
# just that folder so `node dist/main.js` below is the conventional path; the
# rest of the raw dist/ tree (the prisma/*.ts CLI scripts, a redundant compile
# of contracts itself) is unused at runtime and left behind.
COPY --from=build /app/dist/apps/api/src ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /repo/apps/api/prisma ./prisma
COPY apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint \
 && addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD \
  node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["entrypoint"]
