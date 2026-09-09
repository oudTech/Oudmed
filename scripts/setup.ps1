<#
  One-shot local setup for OudHealth. Safe to re-run.

    ./scripts/setup.ps1              full setup (seeds only if the DB is empty)
    $env:RESEED=1; ./scripts/setup.ps1   force a re-seed (adds demo data)

  Prereqs: Node 20, pnpm (corepack enable), Docker Desktop running.
  If scripts are blocked:  powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
#>
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Say  ($m) { Write-Host "`n> $m" -ForegroundColor Cyan }
function OK   ($m) { Write-Host "  ok $m" -ForegroundColor Green }
function Die  ($m) { Write-Host "`nx $m" -ForegroundColor Red; exit 1 }

# ---- prereqs ----------------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue))   { Die "Node.js 20 is required (https://nodejs.org)" }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die "Docker is required and must be running" }
try { docker info *> $null } catch { Die "Docker is installed but not running - start Docker Desktop" }
try { corepack enable *> $null } catch {}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue))   { Die "pnpm not found - run: corepack enable" }

$nodeMajor = [int](node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 20) { Die "Node 20+ required (found $(node -v))" }

# ---- install --------------------------------------------------------------
Say "pnpm install"
pnpm install
if ($LASTEXITCODE -ne 0) { Die "pnpm install failed" }
OK "workspace dependencies"

# ---- env files ----------------------------------------------------------------
Say "environment files"
if (-not (Test-Path apps/api/.env)) {
  Copy-Item apps/api/.env.example apps/api/.env
  OK "apps/api/.env created from .env.example"
} else { OK "apps/api/.env already exists (left as-is)" }

if (-not (Test-Path apps/web/.env.local)) {
  Copy-Item apps/web/.env.example apps/web/.env.local
  OK "apps/web/.env.local created from .env.example"
} else { OK "apps/web/.env.local already exists (left as-is)" }

# ---- backing services ----------------------------------------------------------
Say "docker compose up (Postgres + MinIO)"
docker compose up -d
if ($LASTEXITCODE -ne 0) { Die "docker compose up failed" }

Write-Host "  waiting for services to be healthy" -NoNewline
for ($i = 0; $i -lt 60; $i++) {
  $db = (docker compose ps db --format '{{.Health}}' 2>$null)
  $mn = (docker compose ps minio --format '{{.Health}}' 2>$null)
  if ($db -eq 'healthy' -and $mn -eq 'healthy') { break }
  Write-Host '.' -NoNewline; Start-Sleep -Seconds 2
}
Write-Host ''
if ((docker compose ps db --format '{{.Health}}') -ne 'healthy') { Die "Postgres did not become healthy - check: docker compose logs db" }
OK "Postgres + MinIO healthy"

# ---- database ----------------------------------------------------------------
Say "prisma migrate deploy"
pnpm --filter @oudhealth/api exec prisma migrate deploy
if ($LASTEXITCODE -ne 0) { Die "prisma migrate deploy failed" }
OK "schema up to date"

Say "row-level security policies"
pnpm --filter @oudhealth/api run prisma:rls
if ($LASTEXITCODE -ne 0) { Die "prisma:rls failed" }
OK "RLS applied + grants to oudhealth_app"

# seed only when the User table is empty, unless RESEED=1
$users = (docker compose exec -T db psql -U oudhealth -tAc 'SELECT count(*) FROM "User";' 2>$null)
if ($users) { $users = $users.Trim() } else { $users = '0' }
if ($env:RESEED -eq '1' -or $users -eq '0') {
  Say "seed (demo hospital + users)"
  pnpm --filter @oudhealth/api run seed
  if ($LASTEXITCODE -ne 0) { Die "seed failed" }
  OK "demo data seeded"
} else {
  Say "seed"
  OK "skipped - database already has $users users (set RESEED=1 to force)"
}

# ---- done ----------------------------------------------------------------
Write-Host @'

Setup complete. Start the app in two terminals from the repo root:

  pnpm --filter @oudhealth/api run dev     # http://localhost:3000  (Swagger at /docs)
  pnpm --filter @oudhealth/web run dev     # http://localhost:3001

Then open  http://demo.localhost:3001  and log in:

  admin@demo.com / Admin1234!            (hospital admin)
  reception@demo.com / Password1         (and nurse@ / j.jumbo@ / pharmacy@ / lab@ / accounts@)

Clean reset: docker compose down -v; ./scripts/setup.ps1
'@
