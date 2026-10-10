import { test, expect, tenantPath, authFile, db, fixtures, fieldInput, apiLogin, apiPost, apiGet, eventually } from '../fixtures';

/** T3-17: submit -> batch -> export -> remittance -> receivables aging.
 * Reuses T3-15's real-API visit setup (so the provider resolves genuinely,
 * not seeded around) up through claim generation, then drives the rest of
 * the HMO claims lifecycle - submit, batch, export the schedule, record a
 * remittance with a deliberate shortfall, and confirm Receivables reflects
 * it. Checked by delta, not an absolute total - other specs in this suite
 * generate claims against the same seeded provider in the same run. */
test('T3-17: submit, batch, export, record remittance, receivables aging', async ({ browser }) => {
  test.setTimeout(120_000);
  const f = fixtures();
  const patient = await db.patient.create({
    data: {
      tenantId: f.tenantId, patientNumber: `PT-E2E-${Date.now()}`,
      firstName: 'E2E', lastName: `Remittance${Date.now()}`, registrationStatus: 'COMPLETE',
      insuranceProviderId: f.insuranceProviderId, hmoName: f.insuranceProviderName,
    },
  });

  const token = await apiLogin('admin');
  const visit = await apiPost<{ id: string; insuranceProviderId: string | null }>('/schedule', token, {
    patientId: patient.id, startsAt: new Date().toISOString(), payerType: 'HMO',
  });
  expect(visit.insuranceProviderId).toBe(f.insuranceProviderId);
  await apiPost(`/encounters/${visit.id}/orders`, token, {
    orderType: 'LABORATORY', serviceItemId: f.serviceItemIds.labTest, priority: 'Routine',
  });
  await apiPost(`/schedule/${visit.id}/status`, token, { status: 'CHECKED_IN' });
  await apiPost(`/schedule/${visit.id}/status`, token, { status: 'IN_PROGRESS' });
  await apiPost(`/schedule/${visit.id}/status`, token, { status: 'COMPLETED' });

  const invoice = await eventually(() => db.invoice.findFirstOrThrow({ where: { visitId: visit.id } }));
  const grossTotal = Number(invoice.totalAmount);
  const expectedClaimed = Math.round(grossTotal * (1 - f.insuranceCoPayPct / 100) * 100) / 100;

  const context = await browser.newContext({ storageState: authFile('accountant') });
  const page = await context.newPage();
  await page.goto(tenantPath('/claims'));
  await page.getByRole('button', { name: 'Generate claims' }).click();
  await fieldInput(page, 'Provider').selectOption({ label: f.insuranceProviderName });
  await expect(page.getByText(patient.lastName)).toBeVisible({ timeout: 10_000 });
  await page.locator('tr', { hasText: patient.lastName }).locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /^Generate \(/ }).click();
  await expect(page.getByText(/claim.*created/i)).toBeVisible({ timeout: 10_000 });

  const claim = await eventually(() => db.insuranceClaim.findFirstOrThrow({ where: { patientId: patient.id } }));

  // Submit, unbatched - "New batch" below auto-pulls every unbatched
  // submitted claim for the provider in its period.
  await page.goto(tenantPath('/claims'));
  await page.getByText(claim.claimNumber).click();
  await page.getByRole('button', { name: 'Submit claim' }).click();
  await expect(page.getByText('Submitted', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');

  // Batch it, then export the schedule.
  await page.getByRole('button', { name: 'Batches', exact: true }).click();
  await page.getByRole('button', { name: 'New batch' }).click();
  await fieldInput(page, 'Provider').selectOption({ label: f.insuranceProviderName });
  await page.getByRole('button', { name: 'Create batch' }).click();
  await expect(page.getByText(claim.claimNumber)).toBeVisible({ timeout: 10_000 });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export schedule (CSV)' }).click();
  const csv = await download;
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);

  const batch = await eventually(() => db.claimBatch.findFirstOrThrow({ where: { providerId: f.insuranceProviderId, claims: { some: { id: claim.id } } } }));
  expect(batch.claimCount).toBeGreaterThanOrEqual(1);

  // Mark the batch submitted - a real HMO submission reference, not required.
  await page.getByRole('button', { name: 'Mark submitted' }).click();
  await page.getByRole('button', { name: 'Confirm submitted' }).click();
  await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');

  // Receivables snapshot before the remittance - delta, not an absolute,
  // since other specs' claims against this same provider may already
  // contribute to its running total within this suite run.
  const before = await apiGet<{ rows: { providerId: string; outstanding: string }[] }>('/claims/receivables', token);
  const providerBefore = before.rows.find((r) => r.providerId === f.insuranceProviderId);
  const outstandingBefore = Number(providerBefore?.outstanding ?? 0);

  // Record a remittance with a deliberate shortfall - approved less than
  // claimed, and only part of the approved amount paid now.
  const approved = Math.round(expectedClaimed * 0.8 * 100) / 100;
  const paidNow = Math.round(approved * 0.5 * 100) / 100;
  await page.getByRole('button', { name: 'Remittances', exact: true }).click();
  await page.getByRole('button', { name: 'Record remittance' }).click();
  await expect(page.getByRole('heading', { name: 'Record remittance' })).toBeVisible();
  await fieldInput(page, 'Provider').selectOption({ label: f.insuranceProviderName });
  await fieldInput(page, 'Amount received').fill(String(paidNow));
  await expect(page.getByText(claim.claimNumber)).toBeVisible({ timeout: 10_000 });
  const claimRow = page.locator('tr', { hasText: claim.claimNumber });
  await claimRow.locator('input').first().fill(String(approved));
  await claimRow.locator('input').nth(1).fill(String(paidNow));
  // The modal's own confirm button, not the tab's trigger button behind it
  // (same text) - rendered later in the DOM (a portal), so .last() is the modal's.
  await page.getByRole('button', { name: 'Record remittance', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Record remittance' })).toBeHidden({ timeout: 10_000 });

  const remittedClaim = await eventually(async () => {
    const c = await db.insuranceClaim.findUniqueOrThrow({ where: { id: claim.id } });
    if (Number(c.paidAmount) <= 0) throw new Error(`remittance not yet reflected: ${JSON.stringify(c)}`);
    return c;
  });
  expect(Number(remittedClaim.approvedAmount)).toBeCloseTo(approved, 2);
  expect(Number(remittedClaim.paidAmount)).toBeCloseTo(paidNow, 2);
  expect(remittedClaim.status).toBe('PART_PAID');

  // Receivables aging reflects it: outstanding dropped by exactly what was
  // just paid (the shortfall between claimed and approved is a separate
  // concern - left outstanding here, not written off).
  const after = await apiGet<{ rows: { providerId: string; outstanding: string }[] }>('/claims/receivables', token);
  const providerAfter = after.rows.find((r) => r.providerId === f.insuranceProviderId);
  const outstandingAfter = Number(providerAfter?.outstanding ?? 0);
  expect(outstandingBefore - outstandingAfter).toBeCloseTo(paidNow, 2);

  await page.goto(tenantPath('/claims'));
  await page.getByRole('button', { name: 'Receivables', exact: true }).click();
  await expect(page.getByText(f.insuranceProviderName)).toBeVisible({ timeout: 10_000 });

  await context.close();
});
