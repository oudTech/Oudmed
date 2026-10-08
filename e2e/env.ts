/**
 * Loads apps/api/.env (DATABASE_URL, APP_DB_PASSWORD, ...) so e2e scripts
 * invoked from the repo root (ts-node e2e/seed.ts, or Playwright's
 * globalSetup) see the same database connection apps/api's own dev
 * server resolves on its own - import this first, before anything that
 * touches Prisma or env vars.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', 'apps', 'api', '.env') });
