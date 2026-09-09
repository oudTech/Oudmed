-- Runs once, when the Postgres data volume is first created.
--
-- The API process connects as this dedicated NOSUPERUSER / NOBYPASSRLS role so
-- PostgreSQL row-level security is actually enforced (see apps/api/.env.example,
-- APP_DATABASE_URL). Table-level GRANTs are applied by `pnpm prisma:rls`
-- (rls.sql) after migrations; this file only has to create the role.
--
-- The password here is for LOCAL DEVELOPMENT ONLY. In production the role is
-- created by your database provider and the password lives in a secret store.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oudhealth_app') THEN
    CREATE ROLE oudhealth_app LOGIN PASSWORD 'oudhealth-app-dev'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

GRANT CONNECT ON DATABASE oudhealth TO oudhealth_app;
GRANT USAGE ON SCHEMA public TO oudhealth_app;
