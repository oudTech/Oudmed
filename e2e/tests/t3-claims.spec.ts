import { test, expect, tenantPath, authFile, db, fixtures, fieldInput, apiLogin, apiPost, pageAs, eventually } from '../fixtures';

/** T3-15 (strengthened 2026-10-08, see docs/audit/phase1-status.md): the
 * exact case the HMO-claims investigation found broken - generate an HMO
 * claim, filtering the picker by the specific provider (not "All
 * providers"), and verify the co-pay split is exact, not 100%/0%. The
 * visit is created through the real API (not seeded directly), so
 * ScheduleService.create()'s insurance-provider resolution genuinely runs -
 * a direct-Prisma seed would bypass the exact bug this case exists to
 * catch. */
test('T3-15: generate an HMO claim filtered by provider, co-pay split exact', async ({ browser }) => {
  const f = fixtures();
  const patient = await db.patient.create({
    data: {
      tenantId: f.tenantId, patientNumber: `PT-E2E-${Date.now()}`,
      firstName: 'E2E', lastName: `ClaimsPatient${Date.now()}`, registrationStatus: 'COMPLETE',
      insuranceProviderId: f.insuranceProviderId, hmoName: f.insuranceProviderName,
    },
  });

  // Admin for setup - various actions here (booking, ordering, status
  // transitions) are split across different roles in the real matrix, and
  // this step is only about getting to a billable, completed HMO visit,
  // not about exercising role boundaries (unlike T1-06, which is).
  const token = await apiLogin('admin');
  const visit = await apiPost<{ id: string; insuranceProviderId: string | null }>('/schedule', token, {
    patientId: patient.id, startsAt: new Date().toISOString(), payerType: 'HMO', doctorId: f.userIds.doctor,
  });
  // Fix 1's precondition - if this isn't true, the rest of the test proves nothing.
  expect(visit.insuranceProviderId).toBe(f.insuranceProviderId);

  // MISS-10: no PA code was given at booking (the common case - it usually
  // arrives after) - add one now through the outpatient equivalent of the
  // admission workspace's edit affordance, the schedule drawer.
  const authCode = `PA-OUT-E2E-${Date.now()}`;
  const reception = await pageAs(browser, 'reception');
  await reception.page.goto(tenantPath('/schedule'));
  await reception.page.getByRole('button', { name: new RegExp(patient.lastName) }).click();
  await reception.page.getByRole('button', { name: 'No PA code - add one' }).click();
  await reception.page.locator('input[placeholder="Authorisation / PA code"]').fill(authCode);
  await reception.page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(reception.page.getByText('Authorisation code saved')).toBeVisible({ timeout: 10_000 });
  await expect(reception.page.getByText(authCode)).toBeVisible({ timeout: 10_000 });
  await reception.close();

  await eventually(async () => {
    const row = await db.visit.findUniqueOrThrow({ where: { id: visit.id } });
    if (row.authCode !== authCode) throw new Error('authCode not yet reflected');
  });

  await apiPost(`/encounters/${visit.id}/orders`, token, {
    orderType: 'LABORATORY', serviceItemId: f.serviceItemIds.labTest, priority: 'Routine',
  });
  await apiPost(`/schedule/${visit.id}/status`, token, { status: 'CHECKED_IN' });
  await apiPost(`/schedule/${visit.id}/status`, token, { status: 'IN_PROGRESS' });
  await apiPost(`/schedule/${visit.id}/status`, token, { status: 'COMPLETED' });

  const invoice = await db.invoice.findFirstOrThrow({ where: { visitId: visit.id } });
  const grossTotal = Number(invoice.totalAmount);
  const expectedClaimed = Math.round(grossTotal * (1 - f.insuranceCoPayPct / 100) * 100) / 100;
  const expectedPatientShare = Math.round((grossTotal - expectedClaimed) * 100) / 100;

  const context = await browser.newContext({ storageState: authFile('accountant') });
  const page = await context.newPage();
  await page.goto(tenantPath('/claims'));
  await page.getByRole('button', { name: 'Generate claims' }).click();

  // Filter the picker by this specific provider - the exact symptom this
  // case exists to catch: before Fix 1, the invoice vanished here even
  // though it was genuinely eligible.
  await fieldInput(page, 'Provider').selectOption({ label: f.insuranceProviderName });
  await expect(page.getByText(patient.lastName)).toBeVisible({ timeout: 10_000 });

  await page.locator('tr', { hasText: patient.lastName }).locator('input[type="checkbox"]').check();
  // Not /^Generate/ alone - the page's own "Generate claims" trigger button
  // is still in the DOM behind this modal and would also match that.
  await page.getByRole('button', { name: /^Generate \(/ }).click();
  await expect(page.getByText(/claim.*created/i)).toBeVisible({ timeout: 10_000 });

  const claim = await db.insuranceClaim.findFirstOrThrow({ where: { patientId: patient.id } });
  expect(Number(claim.claimedAmount)).toBeCloseTo(expectedClaimed, 2);
  expect(Number(claim.patientResponsibility)).toBeCloseTo(expectedPatientShare, 2);
  // Not 100%/0% - the exact bug this whole case exists to catch.
  expect(Number(claim.patientResponsibility)).toBeGreaterThan(0);
  // MISS-10: the PA code added through the drawer earlier made it onto the
  // outpatient claim, and outpatient generation was never blocked on it.
  expect(claim.authCode).toBe(authCode);

  // The new claim appears immediately in the Claims list filtered by the
  // same provider - the other half of the original symptom. ClaimsTab's
  // own provider filter select has no Field/label wrapper (unlike the
  // modal's), so it's targeted directly rather than via fieldInput().
  await page.goto(tenantPath('/claims'));
  await page.locator('select').first().selectOption({ label: f.insuranceProviderName });
  await expect(page.getByText(claim.claimNumber)).toBeVisible({ timeout: 10_000 });

  // MISS-10: the claim drawer shows the PA code that was added through the
  // schedule drawer, same "Authorisation" field the admission claim uses.
  await page.locator('tr', { hasText: claim.claimNumber }).click();
  await expect(page.getByText(authCode)).toBeVisible({ timeout: 10_000 });

  await context.close();
});
