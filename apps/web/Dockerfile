# syntax=docker/dockerfile:1
#
# STATUS: structurally complete for the pnpm monorepo + Next.js standalone
# output, and fixed alongside apps/api/Dockerfile (Node 22, .npmrc copied into
# the deps stage). A full `docker build` has not completed end-to-end in every
# environment - registry throttling can time out `pnpm install` on a slow
# connection (Next.js pulls platform-specific SWC binaries for every OS/arch).
# Confirm with a real build before relying on it. See docs/DEPLOY.md.
#
# Build from the REPO ROOT:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api \
#     --build-arg NEXT_PUBLIC_ROOT_DOMAIN=example.com \
#     --build-arg NEXT_PUBLIC_APP_PROTOCOL=https \
#     --build-arg NEXT_PUBLIC_STORAGE_ORIGIN=https://files.example.com \
#     -t oudhealth-web .
#
# NEXT_PUBLIC_* values are baked in at build time, so an image is tied to one
# environment. INTERNAL_API_URL and AUTH_SECRET are read at runtime.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/validation/package.json packages/validation/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ROOT_DOMAIN
ARG NEXT_PUBLIC_APP_PROTOCOL
ARG NEXT_PUBLIC_STORAGE_ORIGIN
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm --filter @oudhealth/web run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD \
  node -e "fetch('http://127.0.0.1:3001/api/auth/providers').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
