import { test, expect, tenantPath, pageAs, db, fixtures, eventually } from '../fixtures';

/** Proves the /billing/admissions route built this round actually works for
 * Accountant, who holds admission:deposit/admission:deposit-refund but not
 * patient:read - so the full inpatient workspace (/admissions/[id]) was
 * never reachable for them. A cash patient (no backdating needed - even a
 * same-day stay posts one minimum full night under the default
 * shortStayChargeMode) admitted, deposited against via this route, then
 * discharged leaving a refund the same route pays out. */
test('Inpatient billing route: Accountant takes a deposit and pays out a refund via /billing/admissions', async ({ browser }) => {
  test.setTimeout(90_000);
  const f = fixtures();
  const patient = await db.patient.create({
    data: {
      tenantId: f.tenantId, patientNumber: `PT-E2E-${Date.now()}`,
      firstName: 'E2E', lastName: `InpatientBilling${Date.now()}`, registrationStatus: 'COMPLETE',
    },
  });

  const nurse = await pageAs(browser, 'nurse');
  await nurse.page.goto(tenantPath('/wards'));
  await nurse.page.getByRole('button', { name: 'Admit here' }).first().click();
  await nurse.page.getByPlaceholder('Search name, patient number or HMO number').fill(patient.lastName);
  await nurse.page.getByRole('button', { name: new RegExp(patient.lastName) }).click();
  await nurse.page.getByRole('button', { name: 'Admit patient' }).click();
  await expect(nurse.page.getByText(/admitted to/)).toBeVisible({ timeout: 10_000 });
  const admission = await eventually(() => db.admission.findFirstOrThrow({ where: { patientId: patient.id } }));

  // Accountant cannot open /admissions/[id] (patient:read) or the plain
  // Wards & Beds board - confirms the gap this route exists to close.
  const accountant = await pageAs(browser, 'accountant');
  await accountant.page.goto(tenantPath(`/admissions/${admission.id}`));
  await expect(accountant.page.getByText('available to clinical and front-desk staff')).toBeVisible();

  // The real route: take a deposit from the "Current admissions" view.
  await accountant.page.goto(tenantPath('/billing/admissions'));
  await accountant.page.locator('tr', { hasText: patient.lastName }).getByRole('button', { name: '+ Deposit' }).click();
  await accountant.page.locator('input[type="number"]').fill('20000');
  await accountant.page.getByRole('button', { name: 'Record deposit' }).click();
  await expect(accountant.page.getByText(/Deposit recorded - receipt/)).toBeVisible({ timeout: 10_000 });

  await eventually(() => db.admissionDeposit.findFirstOrThrow({ where: { admissionId: admission.id, amount: 20000 } }));

  // Discharge same-day - MINIMUM_FULL_DAY still posts one full night, so
  // the 20000 deposit leaves a real remainder. No patient:read needed for
  // this - the nurse context already has it, which is the realistic split
  // of duties (clinical staff discharge, billing staff settle the money).
  await nurse.page.goto(tenantPath('/wards'));
  await nurse.page.getByRole('button', { name: new RegExp(`${patient.firstName} ${patient.lastName}`) }).click();
  await nurse.page.getByRole('button', { name: 'Discharge', exact: true }).click();
  await nurse.page.getByRole('button', { name: 'Confirm discharge' }).click();
  await expect(nurse.page.getByRole('button', { name: 'Confirm discharge' })).toBeHidden({ timeout: 10_000 });
  await nurse.close();

  const refund = await eventually(() => db.admissionRefund.findFirstOrThrow({ where: { admissionId: admission.id } }));
  expect(refund.status).toBe('PENDING');
  expect(Number(refund.amount)).toBeGreaterThan(0);
  expect(Number(refund.amount)).toBeLessThan(20000); // some of the deposit was genuinely owed (the night's charge)

  // The real route's other half: pay the refund out from the
  // "Discharged - balance or refund due" view, same page, no navigating to
  // Refunds due separately.
  await accountant.page.goto(tenantPath('/billing/admissions'));
  await accountant.page.getByRole('button', { name: 'Discharged - balance or refund due' }).click();
  await accountant.page.locator('tr', { hasText: patient.lastName }).getByRole('button', { name: 'Pay out refund' }).click();
  await accountant.page.getByRole('button', { name: 'Pay out', exact: true }).click();
  await expect(accountant.page.getByText(/Refund paid - receipt/)).toBeVisible({ timeout: 10_000 });

  const refundAfter = await eventually(async () => {
    const r = await db.admissionRefund.findUniqueOrThrow({ where: { id: refund.id } });
    if (r.status !== 'PAID') throw new Error('not yet paid');
    return r;
  });
  expect(refundAfter.receiptNumber).toBeTruthy();

  await accountant.close();
});
