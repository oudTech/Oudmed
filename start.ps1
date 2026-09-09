# OudHealth HMS - dev startup
Set-Location $PSScriptRoot

Write-Host "Starting database and object storage..."
docker compose up -d db minio minio-setup | Out-Null

Write-Host "Waiting for Postgres to be healthy..."
$timeout = 60
$elapsed = 0
do {
    Start-Sleep -Seconds 2
    $elapsed += 2
    $health = docker inspect --format "{{.State.Health.Status}}" oudhealth-db-1 2>$null
} while ($health -ne "healthy" -and $elapsed -lt $timeout)

if ($health -ne "healthy") {
    Write-Host "ERROR: Postgres did not become healthy in time." -ForegroundColor Red
    exit 1
}
Write-Host "Postgres is healthy." -ForegroundColor Green

Write-Host ""
Write-Host "Infrastructure is up." -ForegroundColor Green
Write-Host ""
Write-Host "First run only:" -ForegroundColor Cyan
Write-Host "  cd apps/api; cp .env.example .env   # then set APP_DB_PASSWORD + APP_DATABASE_URL"
Write-Host "  pnpm --filter @oudhealth/api exec prisma migrate deploy"
Write-Host "  pnpm --filter @oudhealth/api run db:setup-role"
Write-Host "  pnpm --filter @oudhealth/api run prisma:rls"
Write-Host "  pnpm --filter @oudhealth/api run seed"
Write-Host ""
Write-Host "Then, in two terminals:" -ForegroundColor Cyan
Write-Host "  pnpm --filter @oudhealth/api run start:dev"
Write-Host "  pnpm --filter @oudhealth/web run dev"
Write-Host ""
Write-Host "API:          http://localhost:3000/api/health"
Write-Host "Swagger:      http://localhost:3000/docs"
Write-Host "Frontend:     http://localhost:3001"
Write-Host "MinIO console: http://localhost:9001  (oudhealth / oudhealth-dev-secret)"
