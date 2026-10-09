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

/** Logs in through the real API (not the UI) and returns an access token -
 * for seeding steps that need to exercise real server-side business logic
 * (e.g. ScheduleService.create()'s insurance-provider resolution) without
 * the overhead of driving a browser for a step that isn't what the test
 * is actually about. The UI is still used for whatever IS under test. */
export async function apiLogin(role: keyof typeof E2E.logins): Promise<string> {
  const res = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantSlug: E2E.tenantSlug, email: E2E.logins[role], password: E2E.password }),
  });
  if (!res.ok) throw new Error(`apiLogin(${role}) failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { accessToken: string };
  return data.accessToken;
}

/** POSTs to the real API with a bearer token from apiLogin(). */
export async function apiPost<T = any>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`http://localhost:3000/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export { E2E };
export const test = base;
export { expect };
