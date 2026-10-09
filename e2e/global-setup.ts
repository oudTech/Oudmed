import { chromium, type FullConfig } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { seed, E2E, type SeededFixtures } from './seed';

export const AUTH_DIR = path.join(__dirname, '.auth');
export const FIXTURES_PATH = path.join(__dirname, '.auth', 'fixtures.json');

const TENANT_HOST = `${E2E.tenantSlug}.localhost`;

async function loginAndSave(baseURL: string, role: keyof typeof E2E.logins) {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'] });
  const page = await browser.newPage({ baseURL: `http://${TENANT_HOST}:3001` });
  // Generous timeouts here on purpose: this is the very first request any
  // test makes, so it's the one most likely to hit Next dev-mode's
  // on-demand route compile (worse in CI, where nothing is warm yet).
  page.setDefaultTimeout(45_000);
  await page.goto('/login', { timeout: 45_000 });
  await page.getByLabel('Email').fill(E2E.logins[role]);
  // getByLabel('Password') is ambiguous - the show/hide toggle button
  // inside the field also associates with that label text.
  await page.locator('input[type="password"]').fill(E2E.password);
  await page.getByRole('button', { name: 'Login' }).click();
  // Lands on /dashboard once the session is established.
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
  await page.context().storageState({ path: path.join(AUTH_DIR, `${role}.json`) });
  await browser.close();
}

export default async function globalSetup(config: FullConfig) {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  console.log('[e2e] seeding the e2e tenant...');
  const fixtures: SeededFixtures = await seed();
  fs.writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2));
  console.log(`[e2e] seeded tenant ${fixtures.tenantId}`);

  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3001';
  console.log('[e2e] logging in every role once and saving session state...');
  const roles = Object.keys(E2E.logins) as (keyof typeof E2E.logins)[];
  for (const role of roles) {
    await loginAndSave(baseURL, role);
  }
  console.log('[e2e] auth states saved for:', roles.join(', '));
}
