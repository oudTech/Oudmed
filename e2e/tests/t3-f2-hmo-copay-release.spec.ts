import { test, expect, tenantPath, authFile, db, fixtures, apiLogin, apiPost, eventually } from '../fixtures';

/** The F2 case this suite was missing: T3-06/07/10/12 already prove the
 * whole-item-hold + pay-before-release gate for a CASH patient (coPayPct
 * resolves to 100%, so nothing releases until the whole invoice is paid).
 * This proves the HMO-specific half of the same fix (2026-10-09): an HMO
 * co-pay patient's own payable share is only their configured co-pay
 * percentage, so paying just that share releases the item without ever
 * waiting on the HMO's own (later-remitted) share - and, side by side, a
 * cash patient paying that same proportion is NOT enough. */
test('F2: HMO co-pay patient releases on paying only their co-pay share; a cash patient paying the same proportion stays blocked', async ({ browser }) => {
  test.setTimeout(90_000);
  const f = fixtures();
  await db.tenant.update({ where: { id: f.tenantId }, data: { requirePaymentBeforeDispense: true } });
  const qty = 10;
  const unitPrice = 100; // fixtures' seeded drug sellPrice
  const lineTotal = qty * unitPrice; // 1000
  const coPayShare = Math.round(lineTotal * (f.insuranceCoPayPct / 100)); // 100 (10%)

  // The HMO patient - visit created through the real API so
  // ScheduleService.create()'s provider resolution genuinely runs.
  const hmoPatient = await db.patient.create({
    data: {
      tenantId: f.tenantId, patientNumber: `PT-E2E-${Date.now()}`,
      firstName: 'E2E', lastName: `CopayRelease${Date.now()}`, registrationStatus: 'COMPLETE',
      insuranceProviderId: f.insuranceProviderId, hmoName: f.insuranceProviderName,
    },
  });
  const token = await apiLogin('admin');
  const hmoVisit = await apiPost<{ id: string; insuranceProviderId: string | null }>('/schedule', token, {
    patientId: hmoPatient.id, startsAt: new Date().toISOString(), payerType: 'HMO',
  });
  expect(hmoVisit.insuranceProviderId).toBe(f.insuranceProviderId);
  const hmoRx = await db.prescription.create({
    data: {
      tenantId: f.tenantId, patientId: hmoPatient.id, visitId: hmoVisit.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
      items: { create: [{ tenantId: f.tenantId, drugId: f.drugId, drugName: 'Paracetamol 500mg' }] },
    },
  });

  // The cash control - same drug, same quantity, no insurer at all
  // (coPayPct resolves to 100%).
  const cashPatient = await db.patient.create({
    data: {
      tenantId: f.tenantId, patientNumber: `PT-E2E-${Date.now() + 1}`,
      firstName: 'E2E', lastName: `CashControl${Date.now()}`, registrationStatus: 'COMPLETE',
    },
  });
  const cashVisit = await db.visit.create({
    data: {
      tenantId: f.tenantId, patientId: cashPatient.id, visitType: 'CONSULTATION', status: 'IN_PROGRESS',
      startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 60_000), startedAt: new Date(),
    },
  });
  const cashRx = await db.prescription.create({
    data: {
      tenantId: f.tenantId, patientId: cashPatient.id, visitId: cashVisit.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
      items: { create: [{ tenantId: f.tenantId, drugId: f.drugId, drugName: 'Paracetamol 500mg' }] },
    },
  });

  // Prepare both (pharmacist) - gate on, nothing dispensed yet.
  const pharmacyCtx = await browser.newContext({ storageState: authFile('pharmacist') });
  const pharmacyPage = await pharmacyCtx.newPage();
  await pharmacyPage.goto(tenantPath('/pharmacy'));
  await pharmacyPage.getByRole('button', { name: 'Dispensing', exact: true }).click();

  for (const lastName of [hmoPatient.lastName, cashPatient.lastName]) {
    await pharmacyPage.locator('tr', { hasText: lastName }).getByRole('button', { name: 'Prepare' }).click();
    await pharmacyPage.locator('input[type="number"]').first().fill(String(qty));
    await pharmacyPage.getByRole('button', { name: 'Confirm prepare' }).click();
    await expect(pharmacyPage.getByText(/Prepared for/)).toBeVisible({ timeout: 10_000 });
  }

  const waitPrepared = (prescriptionId: string) =>
    eventually(async () => {
      const item = await db.prescriptionItem.findFirstOrThrow({ where: { prescriptionId } });
      if (!item.preparedInvoiceLineId) throw new Error('not yet prepared');
      return item;
    });
  const hmoItem = await waitPrepared(hmoRx.id);
  const cashItem = await waitPrepared(cashRx.id);
  const hmoLine = await db.invoiceLine.findFirstOrThrow({ where: { id: hmoItem.preparedInvoiceLineId! } });
  const cashLine = await db.invoiceLine.findFirstOrThrow({ where: { id: cashItem.preparedInvoiceLineId! } });
  expect(Number(hmoLine.lineTotal)).toBe(lineTotal);
  expect(Number(cashLine.lineTotal)).toBe(lineTotal);

  // Pay only the co-pay proportion (100 of 1000 = 10%) on BOTH invoices -
  // identical amount, identical proportion, different payer type.
  const billingCtx = await browser.newContext({ storageState: authFile('accountant') });
  const billingPage = await billingCtx.newPage();
  for (const lastName of [hmoPatient.lastName, cashPatient.lastName]) {
    await billingPage.goto(tenantPath('/billing'));
    await billingPage.locator('tr', { hasText: lastName }).getByRole('button', { name: 'Pay' }).click();
    await billingPage.locator('input[type="number"]').fill(String(coPayShare));
    await billingPage.getByRole('button', { name: 'Record Payment', exact: true }).click();
    await expect(billingPage.getByText('Receipt no.')).toBeVisible({ timeout: 10_000 });
    await billingPage.keyboard.press('Escape');
  }
  await billingCtx.close();

  const hmoInvoiceAfterPay = await eventually(async () => {
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: hmoLine.invoiceId } });
    if (Number(inv.totalAmount) <= 0) throw new Error('invoice not ready');
    return inv;
  });
  // Neither invoice is PAID (only 10% of either was paid) - the point is
  // that release does not require that for the HMO one.
  expect(hmoInvoiceAfterPay.status).not.toBe('PAID');

  // HMO: review shows ready, release succeeds - the patient's own co-pay
  // is fully covered, the HMO's 90% share is never waited on.
  await pharmacyPage.goto(tenantPath('/pharmacy'));
  await pharmacyPage.getByRole('button', { name: 'Dispensing', exact: true }).click();
  await pharmacyPage.getByRole('button', { name: 'Awaiting payment', exact: true }).click();
  await pharmacyPage.locator('tr', { hasText: hmoPatient.lastName }).getByRole('button', { name: 'Review' }).click();
  await expect(pharmacyPage.getByText('Paid - ready', { exact: true })).toBeVisible({ timeout: 10_000 });
  await pharmacyPage.getByRole('button', { name: 'Release ready items' }).click();
  await expect(pharmacyPage.getByText(/Released/)).toBeVisible({ timeout: 10_000 });
  const hmoItemAfter = await eventually(async () => {
    const it = await db.prescriptionItem.findUniqueOrThrow({ where: { id: hmoItem.id } });
    if (it.preparedQty !== 0) throw new Error('not yet released');
    return it;
  });
  expect(hmoItemAfter.dispensedQty).toBe(qty);

  // Cash: review shows still blocked - the same 10% does not cover a
  // patient with no insurer at all (their payable share is the whole bill).
  await pharmacyPage.goto(tenantPath('/pharmacy'));
  await pharmacyPage.getByRole('button', { name: 'Dispensing', exact: true }).click();
  await pharmacyPage.getByRole('button', { name: 'Awaiting payment', exact: true }).click();
  await pharmacyPage.locator('tr', { hasText: cashPatient.lastName }).getByRole('button', { name: 'Review' }).click();
  await expect(pharmacyPage.getByText(/Awaiting patient payment: /)).toBeVisible();
  await expect(pharmacyPage.getByRole('button', { name: 'Release ready items' })).toBeDisabled();
  await pharmacyPage.keyboard.press('Escape');

  const cashItemAfter = await db.prescriptionItem.findUniqueOrThrow({ where: { id: cashItem.id } });
  expect(cashItemAfter.dispensedQty ?? 0).toBe(0); // still gated

  await pharmacyCtx.close();
});
