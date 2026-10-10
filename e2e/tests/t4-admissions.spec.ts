import { test, expect, tenantPath, pageAs, db, fixtures, eventually } from '../fixtures';

/** T4-01/05/10/11, run as one connected admission lifecycle (same pattern as
 * T3-06/07/10/12) - an HMO patient with a PA code on file: admit with a
 * deposit, bed-day charges accrue across a ward transfer, discharge leaves
 * a deposit remainder as a pending refund which billing pays out, then the
 * admission's own HMO claim generates cleanly off the PA code. */
test('T4-01/05/10/11: HMO admission - deposit, bed charges + transfer, discharge refund, claim', async ({ browser }) => {
  // One connected lifecycle across 4 roles and ~8 UI steps - comfortably
  // over the default 60s per-test budget even with no single slow step.
  test.setTimeout(150_000);
  const f = fixtures();
  const stamp = Date.now();
  const patient = await db.patient.create({
    data: {
      tenantId: f.tenantId, patientNumber: `PT-E2E-${stamp}`,
      firstName: 'E2E', lastName: `Admission${stamp}`, registrationStatus: 'COMPLETE',
      payerType: 'HMO', hmoName: f.insuranceProviderName, insuranceProviderId: f.insuranceProviderId,
    },
  });

  // T4-01a: admit, through the real UI, into the first available bed - PA
  // code entered right here, through the admit form's own field (the gap
  // this used to have to work around via a direct DB write is now fixed).
  const authCode = `PA-E2E-${stamp}`;
  const nurse = await pageAs(browser, 'nurse');
  await nurse.page.goto(tenantPath('/wards'));
  await nurse.page.getByRole('button', { name: 'Admit here' }).first().click();
  await nurse.page.getByPlaceholder('Search name, patient number or HMO number').fill(patient.lastName);
  await nurse.page.getByRole('button', { name: new RegExp(patient.lastName) }).click();
  await nurse.page.getByPlaceholder(/Leave blank if not yet obtained/).fill(authCode);
  await nurse.page.getByRole('button', { name: 'Admit patient' }).click();
  await expect(nurse.page.getByText(/admitted to/)).toBeVisible({ timeout: 10_000 });

  const admission = await eventually(async () => {
    const row = await db.admission.findFirstOrThrow({ where: { patientId: patient.id } });
    if (row.authCode !== authCode) throw new Error('authCode not yet reflected');
    return row;
  });
  // Backdated 2 days so bed-day charges (F1b) have something real to post
  // once discharged, without waiting 2 real days - still no UI for setting
  // admittedAt directly, which is fine, that's never meant to be editable.
  const admittedAt = new Date(Date.now() - 2 * 86_400_000);
  await db.admission.update({ where: { id: admission.id }, data: { admittedAt } });
  await db.admissionWardStay.updateMany({ where: { admissionId: admission.id, endedAt: null }, data: { startedAt: admittedAt } });

  // T4-01b: take a deposit, through the inpatient workspace, as a role that
  // actually holds admission:deposit (not the admitting nurse).
  const reception = await pageAs(browser, 'reception');
  await reception.page.goto(tenantPath(`/admissions/${admission.id}`));
  await reception.page.getByRole('button', { name: '+ Deposit' }).click();
  await reception.page.locator('input[type="number"]').fill('50000');
  await reception.page.getByRole('button', { name: 'Record deposit' }).click();
  await expect(reception.page.getByText(/Deposit recorded - receipt/)).toBeVisible({ timeout: 10_000 });
  await reception.close();

  const deposit = await eventually(() => db.admissionDeposit.findFirstOrThrow({ where: { admissionId: admission.id } }));
  expect(Number(deposit.amount)).toBe(50000);
  expect(deposit.receiptNumber).toBeTruthy();

  // Deposit shows in the Reports payment ledger - a cash movement, clearly
  // labelled, even though it isn't revenue.
  const admin = await pageAs(browser, 'admin');
  await admin.page.goto(tenantPath('/reports'));
  const ledgerRow = admin.page.locator('tr', { hasText: patient.lastName });
  await expect(ledgerRow.getByText('Deposit', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(ledgerRow.getByText(/50,000|50000/)).toBeVisible();

  // T4-05: a ward/bed transfer mid-stay, through Wards & Beds -> the
  // occupied-bed drawer's "Transfer bed" action.
  await nurse.page.goto(tenantPath('/wards'));
  await nurse.page.getByRole('button', { name: new RegExp(`${patient.firstName} ${patient.lastName}`) }).click();
  await nurse.page.getByRole('button', { name: 'Transfer bed' }).click();
  await nurse.page.locator('select').filter({ hasText: 'Select an available bed' }).selectOption({ index: 1 });
  await nurse.page.getByRole('button', { name: 'Move patient' }).click();
  await expect(nurse.page.getByText(/Transferred to/)).toBeVisible({ timeout: 10_000 });

  const stays = await eventually(async () => {
    const rows = await db.admissionWardStay.findMany({ where: { admissionId: admission.id } });
    if (rows.length < 2) throw new Error(`expected 2 ward-stay rows, found ${rows.length}`);
    return rows;
  });
  expect(stays.length).toBe(2); // the original stay closed, a new one opened at the transfer

  // T4-10: discharge - deposit (50000) comfortably exceeds the patient's
  // own payable share of the bed charges (the HMO's own uncollected share
  // is a separate "still owed" receivable, settled later by claim/
  // remittance, never by this deposit - same F2 patient-payable logic as
  // pharmacy release). Leave "refund now" unchecked (nurse doesn't hold
  // admission:deposit-refund anyway) - the remainder becomes a PENDING
  // refund for billing to pay out later, discharge is never blocked on it.
  await nurse.page.goto(tenantPath('/wards'));
  await nurse.page.getByRole('button', { name: new RegExp(`${patient.firstName} ${patient.lastName}`) }).click();
  await nurse.page.getByRole('button', { name: 'Discharge', exact: true }).click();
  await nurse.page.getByRole('button', { name: 'Confirm discharge' }).click();
  // The drawer closes only once the mutation's onSuccess has run - more
  // robust than waiting on its optional post-discharge status toast, which
  // depends on a second, best-effort async call (wrapped in a swallowed
  // try/catch in AdmissionDrawer) that isn't the thing actually under test.
  await expect(nurse.page.getByRole('button', { name: 'Confirm discharge' })).toBeHidden({ timeout: 10_000 });
  await nurse.close();

  // T4-05's other half: bed-day charges actually posted, spanning both
  // wards/beds the stay touched.
  const bedChargeLines = await eventually(async () => {
    const rows = await db.invoiceLine.findMany({
      where: { invoice: { admissionId: admission.id }, category: 'Inpatient' },
    });
    if (rows.length < 2) throw new Error(`expected at least 2 bed-charge lines, found ${rows.length}`);
    return rows;
  });
  const bedChargeTotal = bedChargeLines.reduce((s, l) => s + Number(l.lineTotal), 0);
  expect(bedChargeTotal).toBeGreaterThanOrEqual(2 * 15000);

  // Discharge's auto-apply only ever consumes the patient's own payable
  // share (the co-pay) from the deposit - never the HMO's expected share -
  // so the refund is the deposit minus that co-pay, not minus the full
  // bed-charge total.
  const patientPayableShare = Math.round(bedChargeTotal * (f.insuranceCoPayPct / 100) * 100) / 100;
  const refund = await eventually(() => db.admissionRefund.findFirstOrThrow({ where: { admissionId: admission.id } }));
  expect(refund.status).toBe('PENDING');
  expect(Number(refund.amount)).toBe(50000 - patientPayableShare);

  // T4-10's payout: an Accountant pays the pending refund from Refunds due.
  const accountant = await pageAs(browser, 'accountant');
  await accountant.page.goto(tenantPath('/billing/refunds-due'));
  await accountant.page.locator('tr', { hasText: patient.lastName }).getByRole('button', { name: 'Pay out' }).click();
  // The modal's own confirm button, not the row's trigger button behind it -
  // rendered later in the DOM (a portal), so .last() is the modal's.
  await accountant.page.getByRole('button', { name: 'Pay out', exact: true }).last().click();
  await expect(accountant.page.getByText(/Refund paid - receipt/)).toBeVisible({ timeout: 10_000 });

  const refundsForAdmission = await eventually(async () => {
    const rows = await db.admissionRefund.findMany({ where: { admissionId: admission.id } });
    if (rows[0]?.status !== 'PAID') throw new Error(`refund not yet PAID: ${JSON.stringify(rows)}`);
    return rows;
  });
  expect(refundsForAdmission).toHaveLength(1); // no double refund - the one request, paid once
  expect(refundsForAdmission[0].status).toBe('PAID');
  expect(refundsForAdmission[0].receiptNumber).toBeTruthy();

  // The PA-code edit affordance, used mid-stay - most PA codes arrive after
  // admission, not at the door, which is exactly why this needs to be
  // editable later and not just enterable once at admit time.
  const updatedAuthCode = `PA-E2E-UPDATED-${stamp}`;
  await admin.page.goto(tenantPath(`/admissions/${admission.id}`));
  await expect(admin.page.getByText(`PA code: ${authCode}`)).toBeVisible({ timeout: 10_000 });
  await admin.page.getByRole('button', { name: 'Edit' }).click();
  await admin.page.locator('input[placeholder="Authorisation / PA code"]').fill(updatedAuthCode);
  await admin.page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(admin.page.getByText('Authorisation code saved')).toBeVisible({ timeout: 10_000 });
  await expect(admin.page.getByText(`PA code: ${updatedAuthCode}`)).toBeVisible({ timeout: 10_000 });

  // T4-11: the admission claim - PA code already on file (just edited),
  // so this generates cleanly with no "no PA code" override needed.
  await admin.page.getByRole('button', { name: 'Generate HMO claim' }).click();
  await admin.page.getByRole('button', { name: 'Generate', exact: true }).click();
  // Not a toast-text match - the page's own static placeholder ("No HMO
  // claim generated yet for this admission.") already contains the words
  // "claim" and "generated", so it would satisfy a loose text match before
  // the real action even ran. The modal closing is the real signal.
  await expect(admin.page.getByRole('button', { name: 'Generate', exact: true })).toBeHidden({ timeout: 10_000 });

  const invoices = await db.invoice.findMany({ where: { admissionId: admission.id } });
  const grossTotal = invoices.reduce((s, i) => s + Number(i.totalAmount), 0);
  const expectedClaimed = Math.round(grossTotal * (1 - f.insuranceCoPayPct / 100) * 100) / 100;
  const expectedPatientShare = Math.round((grossTotal - expectedClaimed) * 100) / 100;

  const claim = await eventually(() => db.insuranceClaim.findFirstOrThrow({ where: { admissionId: admission.id } }));
  expect(claim.authCode).toBe(updatedAuthCode);
  expect(Number(claim.claimedAmount)).toBeCloseTo(expectedClaimed, 2);
  expect(Number(claim.patientResponsibility)).toBeCloseTo(expectedPatientShare, 2);

  // The new claim appears in Claims filtered by provider.
  await accountant.page.goto(tenantPath('/claims'));
  const providerSelect = accountant.page.locator('select').first();
  await expect(providerSelect.locator('option', { hasText: f.insuranceProviderName })).toHaveCount(1, { timeout: 10_000 });
  await providerSelect.selectOption({ label: f.insuranceProviderName });
  await expect(accountant.page.getByText(claim.claimNumber)).toBeVisible({ timeout: 10_000 });

  await accountant.close();
  await admin.close();
});
