#!/bin/sh
# Release-time database steps, then start the API.
#
# Uses DATABASE_URL (the owner role) for migrations and RLS; the app process
# itself connects as APP_DATABASE_URL. The oudhealth_app role must already exist
# (created by your database provider, or `pnpm db:setup-role` on first setup) -
# rls.sql grants to it are guarded and skipped if it is absent.
set -e

echo "> prisma migrate deploy"
node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

echo "> applying rls.sql"
node_modules/.bin/prisma db execute --file prisma/rls.sql --schema prisma/schema.prisma

echo "> starting API"
exec node dist/main
