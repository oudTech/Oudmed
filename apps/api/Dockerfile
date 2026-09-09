# syntax=docker/dockerfile:1
#
# STATUS: not yet built in CI. Structurally complete for the pnpm monorepo;
# validate with a real `docker build` before relying on it. See docs/DEPLOY.md.
#
# Build from the REPO ROOT:
#   docker build -f apps/api/Dockerfile -t oudhealth-api .

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---- deps: whole workspace, against the frozen lockfile ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/validation/package.json packages/validation/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile

# ---- build: prisma generate + nest build, then prune to prod deps ----
FROM deps AS build
COPY . .
RUN pnpm --filter @oudhealth/api exec prisma generate \
 && pnpm --filter @oudhealth/api run build \
 && pnpm --filter @oudhealth/api --prod deploy /app

# ---- runner ----
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
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
