import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { ClaimsModule } from './claims.module';
import { ClaimsService } from './claims.service';
import { AdmissionsModule } from '../admissions/admissions.module';
import { AdmissionsService } from '../admissions/admissions.service';
import { actorFor, destroyTenant, makePatient, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * F1d: generateForAdmission - one claim spanning an entire admission's bill,
 * including the case where that bill spans more than one invoice (the
 * generalised remittance/write-off logic this depends on).
 */
describe('ClaimsService.generateForAdmission (integration - F1d)', () => {
  let prisma: PrismaService;
  let claims: ClaimsService;
  let billing: BillingService;
  let admissions: AdmissionsService;
  let tenantId: string;
  let nurseActor: { tenantId: string; userId: string; role: string };
  let claimsActor: { tenantId: string; userId: string; role: string };
  let providerId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, ClaimsModule, AdmissionsModule],
    }).compile();
    prisma = mod.get(PrismaService);
    claims = mod.get(ClaimsService);
    billing = mod.get(BillingService);
    admissions = mod.get(AdmissionsService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    await ownerPrisma.tenant.update({ where: { id: tenant.id }, data: { shortStayChargeMode: 'NONE' } });
    nurseActor = actorFor(tenantId, (await makeUser(tenantId, 'NURSE')).id, 'NURSE');
    claimsActor = actorFor(tenantId, (await makeUser(tenantId, 'HOSPITAL_ADMIN')).id, 'HOSPITAL_ADMIN');
    providerId = (
      await ownerPrisma.insuranceProvider.create({
        data: { tenantId, name: 'Admission HMO', kind: 'HMO', defaultCoPayPct: 20 },
      })
    ).id;
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  async function makeWard() {
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    return { ward, bed };
  }

  async function admitHmoPatient(authCode: string | undefined = 'AUTH-1') {
    const { ward, bed } = await makeWard();
    const patient = await makePatient(tenantId, {
      payerType: 'HMO', hmoName: 'Admission HMO', insuranceProviderId: providerId, hmoNumber: 'MEM-ADM-1',
    });
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
      payerType: 'HMO', hmoName: 'Admission HMO', authCode,
    } as any);
    return { admission, patient };
  }

  it('blocked while still admitted, without an auth code, or with no billable charges', async () => {
    const { admission: a1 } = await admitHmoPatient();
    await expect(claims.generateForAdmission(claimsActor, a1.id)).rejects.toThrow(/discharged admission/);

    await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToAdmission(tx, {
        tenantId, userId: nurseActor.userId, admissionId: a1.id, patientId: a1.patientId,
        description: 'Ward charge', quantity: 1, unitPrice: 10000, category: 'Inpatient',
      }),
    );
    await admissions.discharge(nurseActor, a1.id, { status: 'DISCHARGED' } as any);
    await expect(claims.generateForAdmission(claimsActor, a1.id)).resolves.toBeDefined(); // has auth code, should succeed

    const { admission: a2 } = await admitHmoPatient('');
    await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToAdmission(tx, {
        tenantId, userId: nurseActor.userId, admissionId: a2.id, patientId: a2.patientId,
        description: 'Ward charge', quantity: 1, unitPrice: 10000, category: 'Inpatient',
      }),
    );
    await admissions.discharge(nurseActor, a2.id, { status: 'DISCHARGED' } as any);
    await expect(claims.generateForAdmission(claimsActor, a2.id)).rejects.toThrow(/pre-authorization/);
  });

  it('one claim spans every invoice an admission\'s bill carries, including a supplementary one', async () => {
    const { admission, patient } = await admitHmoPatient('AUTH-MULTI');
    const { lineId } = await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToAdmission(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'First charge', quantity: 1, unitPrice: 10000, category: 'Inpatient',
      }),
    );
    void lineId;
    const firstInvoiceId = (await ownerPrisma.invoiceLine.findFirst({ where: { description: 'First charge' } }))!.invoiceId;

    // Lock the primary invoice with a real payment so the next charge opens
    // a supplementary invoice instead (the same FUNC-2 mechanism a reopened
    // visit's late charge already uses).
    await prisma.forTenant(tenantId, (tx) =>
      // payerType explicitly CASH - this is the patient's own co-pay payment,
      // not an HMO remittance, and must not be miscounted as one below (a
      // Payment's payerType otherwise defaults to the invoice's own, which
      // is HMO for this admission).
      billing.postPaymentTx(tx, { tenantId, invoiceId: firstInvoiceId, amount: 1000, method: 'CASH', payerType: 'CASH', receivedById: nurseActor.userId }),
    );
    await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToAdmission(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'Second charge', quantity: 1, unitPrice: 20000, category: 'Inpatient',
      }),
    );
    const secondLine = await ownerPrisma.invoiceLine.findFirst({ where: { description: 'Second charge' } });
    expect(secondLine!.invoiceId).not.toBe(firstInvoiceId); // genuinely a second, supplementary invoice

    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);
    const { id: claimId, claimNumber } = await claims.generateForAdmission(claimsActor, admission.id);
    expect(claimNumber).toBeTruthy();

    const claim = await claims.getClaim(claimsActor, claimId);
    expect(claim.lines).toHaveLength(2);
    // 10000 + 20000 = 30000 gross, 20% co-pay -> 24000 claimed, 6000 patient
    expect(Number(claim.claimedAmount)).toBe(24000);
    expect(Number(claim.patientResponsibility)).toBe(6000);
    expect(claim.authCode).toBe('AUTH-MULTI');

    // ── remittance paid in full: proportional split across both invoices ──
    await claims.submitClaim(claimsActor, claimId, {});
    await claims.createRemittance(claimsActor, {
      providerId, receivedAmount: 24000, receivedAt: new Date().toISOString(), reference: 'RMT-MULTI',
      allocations: [{ claimId, approvedAmount: 24000, paidAmount: 24000 }],
    } as any);

    const invFirst = await billing.getInvoice(tenantId, firstInvoiceId);
    const invSecond = await billing.getInvoice(tenantId, secondLine!.invoiceId);
    // first invoice's claimed share was 8000 (10000 * 0.8), second's 16000 (20000 * 0.8)
    const hmoPaymentsFirst = invFirst.payments.filter((p) => p.payerType === 'HMO').reduce((s, p) => s + Number(p.amount), 0);
    const hmoPaymentsSecond = invSecond.payments.filter((p) => p.payerType === 'HMO').reduce((s, p) => s + Number(p.amount), 0);
    expect(hmoPaymentsFirst).toBe(8000);
    expect(hmoPaymentsSecond).toBe(16000);
    expect(hmoPaymentsFirst + hmoPaymentsSecond).toBe(24000); // the whole remittance accounted for, split correctly

    const paidClaim = await claims.getClaim(claimsActor, claimId);
    expect(paidClaim.status).toBe('PAID');
  });

  it('a multi-invoice claim\'s write-off splits proportionally across both invoices', async () => {
    const { admission, patient } = await admitHmoPatient('AUTH-WO');
    await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToAdmission(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'WO first', quantity: 1, unitPrice: 10000, category: 'Inpatient',
      }),
    );
    const firstInvoiceId = (await ownerPrisma.invoiceLine.findFirst({ where: { description: 'WO first' } }))!.invoiceId;
    await prisma.forTenant(tenantId, (tx) =>
      billing.postPaymentTx(tx, { tenantId, invoiceId: firstInvoiceId, amount: 500, method: 'CASH', payerType: 'CASH', receivedById: nurseActor.userId }),
    );
    await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToAdmission(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'WO second', quantity: 1, unitPrice: 10000, category: 'Inpatient',
      }),
    );
    const secondInvoiceId = (await ownerPrisma.invoiceLine.findFirst({ where: { description: 'WO second' } }))!.invoiceId;
    expect(secondInvoiceId).not.toBe(firstInvoiceId);

    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);
    const { id: claimId } = await claims.generateForAdmission(claimsActor, admission.id);
    await claims.submitClaim(claimsActor, claimId, {});

    const totalFirstBefore = Number((await billing.getInvoice(tenantId, firstInvoiceId)).totalAmount);
    const totalSecondBefore = Number((await billing.getInvoice(tenantId, secondInvoiceId)).totalAmount);

    await claims.writeOffClaim(claimsActor, claimId, { reason: 'HMO rejected outright' } as any);
    const written = await claims.getClaim(claimsActor, claimId);
    expect(written.status).toBe('WRITTEN_OFF');
    expect(Number(written.outstanding)).toBe(0);

    const invFirst = await billing.getInvoice(tenantId, firstInvoiceId);
    const invSecond = await billing.getInvoice(tenantId, secondInvoiceId);
    // each invoice's own claimed share (8000 each, equal charges) written off equally
    expect(totalFirstBefore - Number(invFirst.totalAmount)).toBe(8000);
    expect(totalSecondBefore - Number(invSecond.totalAmount)).toBe(8000);
  });

  it('a multi-invoice claim\'s remittance reverses across both invoices, not just one representative payment', async () => {
    const { admission, patient } = await admitHmoPatient('AUTH-REV');
    await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToAdmission(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'REV first', quantity: 1, unitPrice: 10000, category: 'Inpatient',
      }),
    );
    const firstInvoiceId = (await ownerPrisma.invoiceLine.findFirst({ where: { description: 'REV first' } }))!.invoiceId;
    await prisma.forTenant(tenantId, (tx) =>
      billing.postPaymentTx(tx, { tenantId, invoiceId: firstInvoiceId, amount: 500, method: 'CASH', payerType: 'CASH', receivedById: nurseActor.userId }),
    );
    await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToAdmission(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'REV second', quantity: 1, unitPrice: 20000, category: 'Inpatient',
      }),
    );
    const secondInvoiceId = (await ownerPrisma.invoiceLine.findFirst({ where: { description: 'REV second' } }))!.invoiceId;
    expect(secondInvoiceId).not.toBe(firstInvoiceId);

    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);
    const { id: claimId } = await claims.generateForAdmission(claimsActor, admission.id);
    await claims.submitClaim(claimsActor, claimId, {});

    const rmt = await claims.createRemittance(claimsActor, {
      providerId, receivedAmount: 24000, receivedAt: new Date().toISOString(), reference: 'RMT-REV',
      allocations: [{ claimId, approvedAmount: 24000, paidAmount: 24000 }],
    } as any);

    const paidFirst = await billing.getInvoice(tenantId, firstInvoiceId);
    const paidSecond = await billing.getInvoice(tenantId, secondInvoiceId);
    expect(paidFirst.payments.filter((p) => p.payerType === 'HMO' && !p.reversedAt)).toHaveLength(1);
    expect(paidSecond.payments.filter((p) => p.payerType === 'HMO' && !p.reversedAt)).toHaveLength(1);

    await claims.reverseRemittance(claimsActor, rmt.id, { reason: 'posted to the wrong provider' } as any);

    const reversedClaim = await claims.getClaim(claimsActor, claimId);
    expect(reversedClaim.status).toBe('SUBMITTED');
    expect(Number(reversedClaim.paidAmount)).toBe(0);

    const revertedFirst = await billing.getInvoice(tenantId, firstInvoiceId);
    const revertedSecond = await billing.getInvoice(tenantId, secondInvoiceId);
    // both HMO payments reversed - only the unrelated 500 CASH co-pay remains live
    expect(revertedFirst.payments.filter((p) => p.payerType === 'HMO' && !p.reversedAt)).toHaveLength(0);
    expect(revertedSecond.payments.filter((p) => p.payerType === 'HMO' && !p.reversedAt)).toHaveLength(0);
    expect(Number(revertedFirst.paidAmount)).toBe(500);
    expect(Number(revertedSecond.paidAmount)).toBe(0);
  });

  it('F1d backfill verification: every existing claim line resolves to a line genuinely on its own claim\'s invoice(s)', async () => {
    // The permanent version of the two SQL checks from the design doc's
    // "Confirming every existing claim's lines actually resolve" section -
    // run here against the real test data shape, not just the grep-proof.
    // Scoped to this file's own tenant - a global, unscoped query would also
    // see (and could flake on) leftover rows from any other tenant in a
    // shared dev database, which is not what this test is checking.
    const orphanLines = await ownerPrisma.insuranceClaimLine.count({ where: { tenantId, invoiceLineId: null } });
    expect(orphanLines).toBe(0);

    const allLines = await ownerPrisma.insuranceClaimLine.findMany({
      where: { tenantId },
      select: { id: true, claimId: true, invoiceLineId: true },
    });
    for (const line of allLines) {
      const invoiceLine = await ownerPrisma.invoiceLine.findUnique({
        where: { id: line.invoiceLineId! },
        select: { invoiceId: true },
      });
      expect(invoiceLine).not.toBeNull(); // every invoiceLineId points at a real InvoiceLine

      const claim = await ownerPrisma.insuranceClaim.findUnique({
        where: { id: line.claimId },
        select: { invoiceId: true, admissionId: true },
      });
      // a single-invoice (outpatient) claim's lines must belong to its own invoiceId;
      // an admission claim's lines may span more than one invoice by design (F1d)
      if (claim?.invoiceId) {
        expect(invoiceLine!.invoiceId).toBe(claim.invoiceId);
      } else {
        expect(claim?.admissionId).not.toBeNull();
      }
    }
  });
});
