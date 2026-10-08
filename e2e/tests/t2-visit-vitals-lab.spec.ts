import { test, expect, tenantPath, authFile, db, fixtures, fieldInput } from '../fixtures';

/** T2-02: check a patient in and record vitals on their visit. */
test('T2-02: check Patient A in, record vitals', async ({ browser }) => {
  const f = fixtures();
  const patient = await db.patient.create({
    data: {
      tenantId: f.tenantId, patientNumber: `PT-E2E-${Date.now()}`,
      firstName: 'E2E', lastName: `VitalsPatient${Date.now()}`, registrationStatus: 'COMPLETE',
    },
  });
  const visit = await db.visit.create({
    data: {
      tenantId: f.tenantId, patientId: patient.id, visitType: 'CONSULTATION', status: 'SCHEDULED',
      startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 60_000),
      departmentId: f.departmentId,
    },
  });

  const context = await browser.newContext({ storageState: authFile('nurse') });
  const page = await context.newPage();
  await page.goto(tenantPath(`/encounters/${visit.id}`));

  await page.getByRole('button', { name: 'Record vitals' }).click();
  await fieldInput(page, 'Temp (°C)').fill('37.2');
  await fieldInput(page, 'Pulse (bpm)').fill('78');
  await fieldInput(page, 'Systolic BP').fill('120');
  await fieldInput(page, 'Diastolic BP').fill('80');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText(/BP 120\/80/)).toBeVisible({ timeout: 10_000 });

  const saved = await db.vitalSigns.findFirst({ where: { patientId: patient.id, visitId: visit.id } });
  expect(saved).not.toBeNull();
  expect(Number(saved?.pulseBpm)).toBe(78);

  await context.close();
});

/** T2-07: order a lab test, then complete the consultation - completing
 * posts a charge to a new invoice automatically. */
test('T2-07: order a lab test, close the consultation, confirm the invoice', async ({ browser }) => {
  const f = fixtures();
  const patient = await db.patient.create({
    data: {
      tenantId: f.tenantId, patientNumber: `PT-E2E-${Date.now()}`,
      firstName: 'E2E', lastName: `LabPatient${Date.now()}`, registrationStatus: 'COMPLETE',
    },
  });
  const visit = await db.visit.create({
    data: {
      tenantId: f.tenantId, patientId: patient.id, visitType: 'CONSULTATION', status: 'IN_PROGRESS',
      startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 60_000),
      departmentId: f.departmentId, startedAt: new Date(),
    },
  });

  const context = await browser.newContext({ storageState: authFile('doctor') });
  const page = await context.newPage();
  await page.goto(tenantPath(`/encounters/${visit.id}`));

  await page.getByRole('button', { name: 'Order', exact: true }).click();
  await fieldInput(page, 'Search catalogue').fill('Full Blood Count');
  await page.getByText('Full Blood Count', { exact: true }).click();
  await page.getByRole('button', { name: /^Order Full Blood Count/ }).click();
  await expect(page.getByText('Full Blood Count placed')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Complete visit', exact: true }).click();
  await page.getByRole('button', { name: 'Complete visit', exact: true }).last().click();
  await expect(page.getByText(/completed/i)).toBeVisible({ timeout: 10_000 });

  const order = await db.clinicalOrder.findFirst({ where: { visitId: visit.id, orderType: 'LABORATORY' } });
  expect(order).not.toBeNull();
  expect(order?.status).toBe('ORDERED');

  const invoice = await db.invoice.findFirst({ where: { visitId: visit.id }, include: { lines: true } });
  expect(invoice).not.toBeNull();
  expect(invoice!.lines.length).toBeGreaterThan(0);
  expect(Number(invoice!.totalAmount)).toBeGreaterThan(0);

  await context.close();
});
