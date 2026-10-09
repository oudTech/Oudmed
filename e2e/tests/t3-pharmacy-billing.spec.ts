import { test, expect, tenantPath, authFile, db, fixtures } from '../fixtures';

async function makeRxPatient(lastNameTag: string) {
  const f = fixtures();
  const patient = await db.patient.create({
    data: {
      tenantId: f.tenantId, patientNumber: `PT-E2E-${Date.now()}`,
      firstName: 'E2E', lastName: lastNameTag, registrationStatus: 'COMPLETE',
    },
  });
  const visit = await db.visit.create({
    data: {
      tenantId: f.tenantId, patientId: patient.id, visitType: 'CONSULTATION', status: 'IN_PROGRESS',
      startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 60_000), startedAt: new Date(),
    },
  });
  const rx = await db.prescription.create({
    data: {
      tenantId: f.tenantId, patientId: patient.id, visitId: visit.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
      items: { create: [{ tenantId: f.tenantId, drugId: f.drugId, drugName: 'Paracetamol 500mg' }] },
    },
    include: { items: true },
  });
  return { patient, visit, rx };
}

/** T3-02: dispense with the payment gate off (control case) - one step,
 * stock decrements immediately. */
test('T3-02: dispense a prescription with the gate off', async ({ browser }) => {
  const f = fixtures();
  await db.tenant.update({ where: { id: f.tenantId }, data: { requirePaymentBeforeDispense: false } });
  const { patient, rx } = await makeRxPatient(`DispenseGateOff${Date.now()}`);
  const batchBefore = await db.drugBatch.findFirstOrThrow({ where: { drugId: f.drugId } });

  const context = await browser.newContext({ storageState: authFile('pharmacist') });
  const page = await context.newPage();
  await page.goto(tenantPath('/pharmacy'));
  await page.getByText('Dispensing', { exact: true }).click();
  await page.locator('tr', { hasText: patient.lastName }).getByRole('button', { name: 'Dispense' }).click();
  // The quantity input has no prescribed default - a fresh item starts
  // blank and the modal's confirm button stays disabled until it's filled.
  await page.locator('input[type="number"]').first().fill('10');
  await page.getByRole('button', { name: 'Confirm dispense' }).click();
  await expect(page.getByText(/Dispensed to/)).toBeVisible({ timeout: 10_000 });

  const item = await db.prescriptionItem.findFirstOrThrow({ where: { prescriptionId: rx.id } });
  expect(item.dispensedQty).toBeGreaterThan(0);
  const batchAfter = await db.drugBatch.findUniqueOrThrow({ where: { id: batchBefore.id } });
  expect(batchAfter.quantity).toBeLessThan(batchBefore.quantity);

  await context.close();
});

/** T3-06/T3-07/T3-10/T3-12, run as one connected sequence since each step
 * only makes sense against the previous one's state: prepare with the
 * gate on -> release is blocked before payment -> pay the invoice in
 * full -> release now succeeds. */
test('T3-06/07/10/12: prepare, blocked release, pay, release after payment', async ({ browser }) => {
  const f = fixtures();
  await db.tenant.update({ where: { id: f.tenantId }, data: { requirePaymentBeforeDispense: true } });
  const { patient, rx } = await makeRxPatient(`GatedFlow${Date.now()}`);

  const pharmacyCtx = await browser.newContext({ storageState: authFile('pharmacist') });
  const pharmacyPage = await pharmacyCtx.newPage();
  await pharmacyPage.goto(tenantPath('/pharmacy'));
  await pharmacyPage.getByRole('button', { name: 'Dispensing', exact: true }).click();

  // T3-06: Prepare.
  await pharmacyPage.locator('tr', { hasText: patient.lastName }).getByRole('button', { name: 'Prepare' }).click();
  await pharmacyPage.locator('input[type="number"]').first().fill('10');
  await pharmacyPage.getByRole('button', { name: 'Confirm prepare' }).click();
  await expect(pharmacyPage.getByText(/Prepared for/)).toBeVisible({ timeout: 10_000 });

  const prepared = await db.prescriptionItem.findFirstOrThrow({ where: { prescriptionId: rx.id } });
  expect(prepared.preparedQty).toBeGreaterThan(0);
  expect(prepared.dispensedQty ?? 0).toBe(0);

  // T3-07: attempt release before payment - blocked. The item moved out of
  // the default "Awaiting" (PENDING) filter into "Awaiting payment".
  await pharmacyPage.getByRole('button', { name: 'Awaiting payment', exact: true }).click();
  await pharmacyPage.locator('tr', { hasText: patient.lastName }).getByRole('button', { name: 'Review' }).click();
  await expect(pharmacyPage.getByText(/Awaiting patient payment: /)).toBeVisible();
  const releaseBtn = pharmacyPage.getByRole('button', { name: 'Release ready items' });
  await expect(releaseBtn).toBeDisabled();
  await pharmacyPage.keyboard.press('Escape');

  const stillPrepared = await db.prescriptionItem.findUniqueOrThrow({ where: { id: prepared.id } });
  expect(stillPrepared.dispensedQty ?? 0).toBe(0);

  // T3-10: pay the invoice (as Accountant) in full.
  const line = await db.invoiceLine.findFirstOrThrow({ where: { id: prepared.preparedInvoiceLineId! } });
  const billingCtx = await browser.newContext({ storageState: authFile('accountant') });
  const billingPage = await billingCtx.newPage();
  await billingPage.goto(tenantPath('/billing'));
  await billingPage.locator('tr', { hasText: patient.lastName }).getByRole('button', { name: 'Pay' }).click();
  await billingPage.getByRole('button', { name: 'Pay full amount' }).click();
  await billingPage.getByRole('button', { name: 'Record Payment', exact: true }).click();
  await expect(billingPage.getByText('Receipt no.')).toBeVisible({ timeout: 10_000 });
  await billingCtx.close();

  const invoiceAfterPay = await db.invoice.findUniqueOrThrow({ where: { id: line.invoiceId } });
  expect(invoiceAfterPay.status).toBe('PAID');

  // T3-12: release now succeeds.
  await pharmacyPage.goto(tenantPath('/pharmacy'));
  await pharmacyPage.getByRole('button', { name: 'Dispensing', exact: true }).click();
  await pharmacyPage.getByRole('button', { name: 'Awaiting payment', exact: true }).click();
  await pharmacyPage.locator('tr', { hasText: patient.lastName }).getByRole('button', { name: 'Review' }).click();
  await expect(pharmacyPage.getByText('Paid - ready', { exact: true })).toBeVisible({ timeout: 10_000 });
  await pharmacyPage.getByRole('button', { name: 'Release ready items' }).click();
  await expect(pharmacyPage.getByText(/Released/)).toBeVisible({ timeout: 10_000 });

  const released = await db.prescriptionItem.findUniqueOrThrow({ where: { id: prepared.id } });
  expect(released.preparedQty).toBe(0);
  expect(released.dispensedQty).toBeGreaterThan(0);

  await pharmacyCtx.close();
});
