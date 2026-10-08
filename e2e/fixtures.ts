import * as path from 'path';
import * as fs from 'fs';
import { test as base, expect, type Browser, type Page, type Locator } from '@playwright/test';
import './env';
import { PrismaClient } from './prisma';
import { E2E, type SeededFixtures } from './seed';
import { AUTH_DIR, FIXTURES_PATH } from './global-setup';

/** Direct DB access for per-test fixture seeding (a patient, a visit, a
 * prescription...) - same role int-helpers.ts's ownerPrisma plays for the
 * integration suite: bypasses RLS, used only to set up state quickly
 * before driving the real UI for the action actually under test. */
export const db = new PrismaClient();

let _fixtures: SeededFixtures | null = null;
/** The base e2e tenant's fixed ids (department, service items, drug,
 * ward/beds, insurance provider) written by global-setup.ts after seeding. */
export function fixtures(): SeededFixtures {
  if (!_fixtures) _fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf-8'));
  return _fixtures!;
}

export function authFile(role: keyof typeof E2E.logins): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

export const tenantPath = (p = '/') => `http://${E2E.tenantSlug}.localhost:3001${p}`;
export const suspendTenantPath = (p = '/') => `http://${E2E.suspendTenantSlug}.localhost:3001${p}`;
export const apexPath = (p = '/') => `http://localhost:3001${p}`;
export const platformPath = (p = '/') => `http://localhost:3001/platform${p}`;

/** Opens a fresh, independently-authenticated page as a different role
 * than the test file's default storageState - for a test that needs more
 * than one actor (e.g. prepare as Pharmacist, pay as Accountant). Caller
 * closes the returned context when done. */
export async function pageAs(browser: Browser, role: keyof typeof E2E.logins): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: authFile(role) });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

/** components/ui/kit.tsx's Field renders `<label>text</label>` as a plain
 * sibling of its input/select/textarea child, with no `htmlFor`/`id` or
 * `aria-labelledby` connecting them - so Playwright's getByLabel() can
 * never find the control (it has no accessible-name association at all,
 * a real gap worth fixing separately in the app itself). Until then, every
 * form in the app needs this instead: find the label text, then the first
 * following-sibling form control. */
export function fieldInput(scope: Page | Locator, label: string): Locator {
  return scope
    .locator('label', { hasText: label })
    .locator('xpath=following-sibling::*[self::input or self::select or self::textarea][1]');
}

export { E2E };
export const test = base;
export { expect };
