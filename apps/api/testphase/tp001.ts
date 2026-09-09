/* eslint-disable */
// Focused TP-001 security analysis. Boots the full app, verifies each claim.
import 'reflect-metadata';
import { ValidationPipe, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { owner, seedTenant, destroyTenant, makeReq, Who } from './harness';

const shim = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const h = req.headers['x-test-user'];
    if (!h) return false;
    req.user = JSON.parse(Array.isArray(h) ? h[0] : h);
    return true;
  },
};

(async () => {
  const A = await seedTenant('x1a');
  const B = await seedTenant('x1b');
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(JwtAuthGuard).useValue(shim)
    .overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  const req = makeReq(await app.getUrl());
  const L = (k: string, v: any) => console.log(`  ${k.padEnd(58)} ${typeof v === 'object' ? JSON.stringify(v).slice(0, 260) : v}`);

  const bAcc = B.users.ACCOUNTANT, bAdm = B.users.HOSPITAL_ADMIN, bRec = B.users.RECEPTIONIST;

  console.log('\n=== 1. B injects an invoice referencing tenant A patientId ===');
  const inj = await req('POST', '/billing/invoices', bAcc, { patientId: A.patientId, lines: [{ description: 'x', quantity: 1, unitPrice: 5000 }] });
  L('POST /billing/invoices {patientId: <A patient>}', `status=${inj.status} body=${JSON.stringify(inj.body)}`);
  const injId = inj.body?.id;
  const row = injId ? await owner.invoice.findUnique({ where: { id: injId }, include: { lines: true } }) : null;
  L('DB row tenantId', row?.tenantId + ` (B=${B.tenantId})`);
  L('DB row patientId', row?.patientId + ` (A patient=${A.patientId})`);
  L('DB line tenantId', row?.lines?.[0]?.tenantId);
  L('audit row written under tenant', (await owner.auditLog.findFirst({ where: { entityId: injId ?? 'none' } }))?.tenantId);

  console.log('\n=== 2. Can B read the poisoned invoice back? ===');
  const gb = await req('GET', `/billing/invoices/${injId}`, bAcc, undefined);
  L('GET /billing/invoices/:id (as B)', `status=${gb.status} body=${JSON.stringify(gb.body).slice(0, 200)}`);

  console.log('\n=== 3. Does the poison break B\'s WHOLE billing list? (persistent DoS) ===');
  const lb = await req('GET', '/billing/invoices', bAcc, undefined);
  L('GET /billing/invoices (as B, list)', `status=${lb.status} body=${JSON.stringify(lb.body).slice(0, 200)}`);
  const lb2 = await req('GET', '/billing/invoices', bAdm, undefined);
  L('GET /billing/invoices (as B admin)', `status=${lb2.status}`);
  const cat = await req('GET', '/billing/catalogue', bAcc, undefined);
  L('GET /billing/catalogue (as B)', `status=${cat.status}`);

  console.log('\n=== 4. Does it break B\'s dashboard / home / reports? ===');
  L('GET /home (as B accountant)', `status=${(await req('GET', '/home', bAcc, undefined)).status}`);
  L('GET /home (as B receptionist)', `status=${(await req('GET', '/home', bRec, undefined)).status}`);
  L('GET /reports/overview (as B admin)', `status=${(await req('GET', '/reports/overview', bAdm, undefined)).status}`);
  L('GET /reports/payments (as B admin)', `status=${(await req('GET', '/reports/payments', bAdm, undefined)).status}`);

  console.log('\n=== 5. Can B remediate it in-app? (cancel / edit / remove line) ===');
  L('POST /billing/invoices/:id/cancel (as B)', `status=${(await req('POST', `/billing/invoices/${injId}/cancel`, bAcc, { reason: 'undo' })).status}`);
  const lb3 = await req('GET', '/billing/invoices', bAcc, undefined);
  L('GET /billing/invoices after cancel', `status=${lb3.status}`);
  // re-inject for the remaining tests
  const inj2 = await req('POST', '/billing/invoices', bAcc, { patientId: A.patient2Id, lines: [{ description: 'y', quantity: 1, unitPrice: 1000 }] });
  const inj2Id = inj2.body?.id;
  L('re-inject invoice', `status=${inj2.status}`);
  L('PATCH /billing/invoices/:id (as B)', `status=${(await req('PATCH', `/billing/invoices/${inj2Id}`, bAcc, { note: 'z' })).status}`);

  console.log('\n=== 6. Can B add a PAYMENT to the poisoned invoice? (financial pollution) ===');
  const payr = await req('POST', `/billing/invoices/${inj2Id}/payments`, bAcc, { amount: 100, method: 'CASH' });
  L('POST /billing/invoices/:id/payments (as B)', `status=${payr.status} body=${JSON.stringify(payr.body).slice(0, 150)}`);
  const payRow = await owner.payment.findFirst({ where: { invoiceId: inj2Id ?? 'none' } });
  L('payment DB row tenantId / receiptNumber', `${payRow?.tenantId} / ${payRow?.receiptNumber}`);

  console.log('\n=== 7. Does A see ANYTHING? (cross-tenant read of injected invoice) ===');
  L('A accountant GET /billing/invoices/:id (inj)', `status=${(await req('GET', `/billing/invoices/${injId}`, A.users.ACCOUNTANT, undefined)).status}`);
  const al = await req('GET', '/billing/invoices', A.users.ACCOUNTANT, undefined);
  L('A billing list status', `status=${al.status} count=${al.body?.total}`);
  const apInv = await req('GET', `/patients/${A.patientId}/invoices`, A.users.DOCTOR, undefined);
  L('A GET /patients/:id/invoices (A patient)', `status=${apInv.status} rows=${Array.isArray(apInv.body) ? apInv.body.length : 'n/a'} hasInj=${JSON.stringify(apInv.body).includes(injId)}`);
  L('A /home', `status=${(await req('GET', '/home', A.users.RECEPTIONIST, undefined)).status}`);
  L('A /reports/overview', `status=${(await req('GET', '/reports/overview', A.users.HOSPITAL_ADMIN, undefined)).status}`);

  console.log('\n=== 8. visitId injection: squat A\'s visit invoice slot (@unique) ===');
  // A has NO invoice for A.noteVisitId yet
  const vinj = await req('POST', '/billing/invoices', bAcc, { patientId: B.patientId, visitId: A.noteVisitId, lines: [{ description: 'squat', quantity: 1, unitPrice: 1 }] });
  L('B POST /billing/invoices {visitId: <A visit>}', `status=${vinj.status} body=${JSON.stringify(vinj.body).slice(0, 150)}`);
  if (vinj.status < 300) {
    const vrow = await owner.invoice.findUnique({ where: { id: vinj.body.id } });
    L('  injected invoice visitId / tenantId', `${vrow?.visitId} / ${vrow?.tenantId}`);
    // now A tries to charge that visit (postChargeToVisit path) via a dispense on a rx for that visit
    const rxA = await owner.prescription.create({ data: { tenantId: A.tenantId, patientId: A.patientId, visitId: A.noteVisitId, status: 'ACTIVE', dispenseStatus: 'PENDING', items: { create: [{ tenantId: A.tenantId, drugId: A.drugId, drugName: 'D' }] } }, include: { items: true } });
    const dispA = await req('POST', `/pharmacy/prescriptions/${rxA.id}/dispense`, A.users.PHARMACIST, { items: [{ itemId: rxA.items[0].id, quantity: 1, unitPrice: 10 }] });
    L('  A dispense -> postChargeToVisit on the squatted visit', `status=${dispA.status} body=${JSON.stringify(dispA.body).slice(0, 200)}`);
    // and A's direct invoice-for-visit path
    const aInvVisit = await req('POST', '/billing/invoices', A.users.ACCOUNTANT, { patientId: A.patientId, visitId: A.noteVisitId, lines: [{ description: 'consult', quantity: 1, unitPrice: 5000 }] });
    L('  A POST /billing/invoices {visitId: <own visit>}', `status=${aInvVisit.status} body=${JSON.stringify(aInvVisit.body).slice(0, 150)}`);
  }

  console.log('\n=== 9. serviceItemId / drugId line injection ===');
  const linj = await req('POST', '/billing/invoices', bAcc, { patientId: B.patientId, lines: [{ description: 'x', quantity: 1, unitPrice: 100, serviceItemId: A.serviceItemId, drugId: A.drugId }] });
  L('B invoice with A.serviceItemId + A.drugId in line', `status=${linj.status}`);
  if (linj.status < 300) {
    const lr = await owner.invoiceLine.findFirst({ where: { invoiceId: linj.body.id } });
    L('  line serviceItemId / drugId / tenantId', `${lr?.serviceItemId} / ${lr?.drugId} / ${lr?.tenantId}`);
    const gl = await req('GET', `/billing/invoices/${linj.body.id}`, bAcc, undefined);
    L('  B GET that invoice', `status=${gl.status} (drug join? ${JSON.stringify(gl.body).slice(0, 120)})`);
  }

  console.log('\n=== 10. non-existent / malformed patientId ===');
  L('patientId = random uuid (no such patient)', `status=${(await req('POST', '/billing/invoices', bAcc, { patientId: '00000000-0000-0000-0000-000000000000', lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] })).status}`);
  L('patientId = "not-a-uuid"', `status=${(await req('POST', '/billing/invoices', bAcc, { patientId: 'not-a-uuid', lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] })).status}`);
  L('legacy POST /invoices {patientId: <A>}', `status=${(await req('POST', '/invoices', bAcc, { patientId: A.patientId, lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] })).status}`);
  // clinical.payInvoice path
  L('POST /patients/:pid/invoices/:id/payments cross-patient', `status=${(await req('POST', `/patients/${B.patientId}/invoices/${A.invoiceId}/payments`, bRec, { amount: 1, method: 'CASH' })).status}`);

  console.log('\n=== 11. where do patient UUIDs appear in normal (same-tenant) responses? ===');
  const bpl = await req('GET', '/patients', B.users.DOCTOR, undefined);
  L('GET /patients list -> patients[].id present?', JSON.stringify(bpl.body).includes(B.patientId));
  const bdup = await req('POST', '/patients/check-duplicates', B.users.RECEPTIONIST, { lastName: 'B' });
  L('POST /patients/check-duplicates -> matches[].id present?', JSON.stringify(bdup.body).includes('"id"'));
  const bsch = await req('GET', '/schedule', B.users.DOCTOR, undefined);
  L('GET /schedule -> patient id present?', JSON.stringify(bsch.body).slice(0, 300));

  await app.close();
  await destroyTenant(A.tenantId);
  await destroyTenant(B.tenantId);
  await owner.$disconnect();
  console.log('\ndone');
})().catch((e) => { console.error(e); process.exit(1); });
