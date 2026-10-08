import { test, expect, apexPath, tenantPath, authFile, db, fieldInput } from '../fixtures';
import { waitForVerificationCode } from '../verification-code';

/** T1-02 / T1-03: new-hospital sign-up end to end - account, email
 * verification (6-digit code, not a link - the dev-mode log fallback
 * stands in for a real inbox, same as docs/DEPLOYMENT.md describes for
 * an unset RESEND_API_KEY), hospital creation, landing on the dashboard. */
test('T1-02/T1-03: sign up, verify by code, create the hospital, land on the dashboard', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-signup-${stamp}@oudmed.test`;
  const hospitalName = `E2E Signup Hospital ${stamp}`;

  await page.goto(apexPath('/signup'));
  await page.getByLabel('Full name').fill('E2E Signup Admin');
  await page.getByLabel('Email').fill(email);
  await page.locator('input[type="password"]').fill('SignupPass123!');
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/verify-email/);
  const code = await waitForVerificationCode(email);
  await page.getByLabel('Enter code here').fill(code);
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel('Hospital name').fill(hospitalName);
  await page.getByLabel('Country').selectOption({ label: 'Nigeria' }).catch(() => page.getByLabel('Country').selectOption({ index: 1 }));
  await page.getByRole('button', { name: 'Continue' }).click();

  // "Your workspace is ready" screen, then into the real dashboard.
  await expect(page.getByText('Your workspace is ready.')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Continue to dashboard' }).click();
  // First request to a brand-new tenant subdomain - Next dev-mode compiles
  // the route on demand, which can take a while the very first time.
  await page.waitForURL(/\/dashboard/, { timeout: 40_000 });

  const created = await db.tenant.findFirst({ where: { name: hospitalName } });
  expect(created).not.toBeNull();
  expect(created?.slug).toBeTruthy();
});

/** T1-06: role-based access - a Receptionist sees no HR/Reports/Claims/
 * Admin in the nav, and direct URL navigation to /admin is also blocked,
 * not just hidden. */
test('T1-06: Reception sees no HR/Admin/Reports/Claims in the nav, and /admin is blocked directly', async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile('reception') });
  const page = await context.newPage();
  await page.goto(tenantPath('/dashboard'));

  for (const label of ['Human resources', 'Reports', 'Claims', 'Administration']) {
    await expect(page.getByRole('link', { name: label })).toHaveCount(0);
  }

  await page.goto(tenantPath('/admin'));
  await expect(page.getByText('Only a hospital admin can manage services, departments and insurance providers.')).toBeVisible();
  await expect(page.getByText('Services', { exact: true })).toHaveCount(0);

  await context.close();
});

/** T1-08: complete a patient's registration through the wizard (steps
 * 1-8 - run as one continuous flow here, rather than "resume from step 3"
 * as the manual plan does, since this is an independent e2e case with no
 * prior test's state to resume from). */
test('T1-08: register a new patient through the full wizard', async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile('reception') });
  const page = await context.newPage();
  await page.goto(tenantPath('/patients/new'));

  // Step 1: dedupe check - a brand-new name has no matches, Continue proceeds to step 2.
  const stamp = Date.now();
  const firstName = 'E2E';
  const lastName = `Patient${stamp}`;
  await page.getByRole('button', { name: "This is a new patient - continue" }).click();

  // Step 2: required basic info. Note: "Continue" (exact) - the wizard also
  // shows a "Save & finish later" button from step 3 on, which a loose
  // name match would click first by DOM order instead.
  await expect(page.getByText('Step 2 of 8')).toBeVisible();
  // components/ui/kit.tsx's Field has no label/input association (see
  // fixtures.ts's fieldInput doc comment) - getByLabel can't find these.
  await fieldInput(page, 'First name').fill(firstName);
  await fieldInput(page, 'Last name').fill(lastName);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Steps 3-7: everything is optional for this smoke case - just advance.
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }

  // Step 8: review and submit.
  await expect(page.getByText('Step 8 of 8')).toBeVisible();
  await page.getByRole('button', { name: 'Finish registration' }).click();

  await expect(page.getByText(/registered/i)).toBeVisible({ timeout: 10_000 });
  await page.goto(tenantPath('/patients'));
  await expect(page.getByText(`${firstName} ${lastName}`)).toBeVisible();
  await context.close();
});
