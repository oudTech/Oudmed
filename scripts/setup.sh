#!/usr/bin/env bash
#
# One-shot local setup for OudHealth. Safe to re-run.
#
#   ./scripts/setup.sh              full setup (seeds only if the DB is empty)
#   RESEED=1 ./scripts/setup.sh     force a re-seed (adds demo data)
#
# Prereqs: Node 22, pnpm (corepack enable), Docker Desktop running.
# After it finishes, start the two dev servers (it prints the commands).

set -euo pipefail
cd "$(dirname "$0")/.."

say()  { printf '\n\033[1;36m> %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31mx %s\033[0m\n' "$1" >&2; exit 1; }

# ---- prereqs ----------------------------------------------------------------
command -v node   >/dev/null || die "Node.js 22 is required - pnpm 11 needs it (https://nodejs.org)"
command -v docker >/dev/null || die "Docker is required and must be running"
docker info >/dev/null 2>&1  || die "Docker is installed but not running - start Docker Desktop"
corepack enable >/dev/null 2>&1 || true
command -v pnpm >/dev/null || die "pnpm not found - run: corepack enable"

node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" -ge 22 ] || die "Node 22+ required (found $(node -v))"

# ---- install --------------------------------------------------------------
say "pnpm install"
pnpm install
ok "workspace dependencies"

# ---- env files ----------------------------------------------------------------
say "environment files"
if [ ! -f apps/api/.env ]; then
  cp apps/api/.env.example apps/api/.env
  ok "apps/api/.env created from .env.example"
else
  ok "apps/api/.env already exists (left as-is)"
fi
if [ ! -f apps/web/.env.local ]; then
  cp apps/web/.env.example apps/web/.env.local
  ok "apps/web/.env.local created from .env.example"
else
  ok "apps/web/.env.local already exists (left as-is)"
fi

# ---- backing services ----------------------------------------------------------
say "docker compose up (Postgres + MinIO)"
docker compose up -d

printf '  waiting for services to be healthy'
for _ in $(seq 1 60); do
  db=$(docker compose ps db --format '{{.Health}}' 2>/dev/null || echo starting)
  mn=$(docker compose ps minio --format '{{.Health}}' 2>/dev/null || echo starting)
  if [ "$db" = "healthy" ] && [ "$mn" = "healthy" ]; then break; fi
  printf '.'; sleep 2
done
printf '\n'
[ "$(docker compose ps db --format '{{.Health}}')" = "healthy" ] || die "Postgres did not become healthy - check: docker compose logs db"
ok "Postgres + MinIO healthy"

# ---- database ----------------------------------------------------------------
say "prisma migrate deploy"
pnpm --filter @oudhealth/api exec prisma migrate deploy
ok "schema up to date"

say "row-level security policies"
pnpm --filter @oudhealth/api run prisma:rls
ok "RLS applied + grants to oudhealth_app"

# seed only when the User table is empty, unless RESEED=1
users=$(docker compose exec -T db psql -U oudhealth -tAc 'SELECT count(*) FROM "User";' 2>/dev/null | tr -d '[:space:]' || echo 0)
if [ "${RESEED:-0}" = "1" ] || [ "${users:-0}" = "0" ]; then
  say "seed (demo hospital + users)"
  pnpm --filter @oudhealth/api run seed
  ok "demo data seeded"
else
  say "seed"
  ok "skipped - database already has $users users (RESEED=1 to force)"
fi

# ---- done ----------------------------------------------------------------
cat <<'EOF'

Setup complete. Start the app in two terminals from the repo root:

  pnpm --filter @oudhealth/api run dev     # http://localhost:3000  (Swagger at /docs)
  pnpm --filter @oudhealth/web run dev     # http://localhost:3001

Then open  http://demo.localhost:3001  and log in:

  admin@demo.com / Admin1234!            (hospital admin)
  reception@demo.com / Password1         (and nurse@ / j.jumbo@ / pharmacy@ / lab@ / accounts@)

Safari only: add "127.0.0.1 demo.localhost" to /etc/hosts first.
Clean reset: docker compose down -v && ./scripts/setup.sh
EOF
