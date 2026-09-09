/**
 * Provisions the dedicated runtime database role `oudhealth_app`:
 * LOGIN, NOSUPERUSER, NOBYPASSRLS. The running API connects as this role
 * (via APP_DATABASE_URL) so row-level security is actually enforced.
 *
 * Migrations, `seed` and `apply-rls` keep running as the owner (DATABASE_URL).
 * Re-run this after any migration that adds tables.
 *
 *   APP_DB_PASSWORD=... pnpm db:setup-role
 */
import { PrismaClient } from '@prisma/client';

const ROLE = 'oudhealth_app';

async function main() {
  const password = process.env.APP_DB_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('Set APP_DB_PASSWORD (>= 8 chars) before running db:setup-role');
  }
  // Basic guard: the role name is a constant; only the password is dynamic and
  // is single-quote escaped for the CREATE/ALTER ROLE statement.
  const pw = password.replace(/'/g, "''");

  const prisma = new PrismaClient();
  try {
    const dbName: { current_database: string }[] = await prisma.$queryRawUnsafe(
      'SELECT current_database()',
    );
    const db = dbName[0].current_database;

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
          CREATE ROLE ${ROLE} LOGIN PASSWORD '${pw}'
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
        ELSE
          ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${pw}'
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${db}" TO ${ROLE};`);
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${ROLE};`);
    await prisma.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE};`,
    );
    await prisma.$executeRawUnsafe(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE};`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE};`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE};`,
    );

    // The app role must never be allowed to bypass RLS even if it is later
    // granted membership in another role.
    await prisma.$executeRawUnsafe(`ALTER ROLE ${ROLE} NOBYPASSRLS;`);

    console.log(`✓ Role ${ROLE} provisioned on "${db}" (NOSUPERUSER, NOBYPASSRLS)`);
    console.log(
      `  Set APP_DATABASE_URL=postgresql://${ROLE}:<APP_DB_PASSWORD>@<host>:5432/${db}?schema=public`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
