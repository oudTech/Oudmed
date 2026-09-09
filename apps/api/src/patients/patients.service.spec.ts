import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PatientsService } from './patients.service';

/**
 * NN10 regression: PatientsService.create / update must not depend on
 * getOne()'s patient:read authorization. They now return via the private
 * readOne() lookup. These tests stub getOne to blow up and assert create/update
 * still succeed, and that getOne itself still enforces patient:read.
 */

const patientRow = {
  id: 'p1',
  tenantId: 't1',
  patientNumber: 'PT-00001',
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: null as Date | null,
  photoUrl: null as string | null,
  registrationStatus: 'INCOMPLETE',
  consentGivenAt: null as Date | null,
  registrationStep: 2,
};

function fakeTx() {
  const zeroAgg = { _count: 0, _sum: { totalAmount: null as Prisma.Decimal | null } };
  return {
    // nextSequence() fast path: UPDATE ... RETURNING "value"
    $queryRaw: jest.fn().mockResolvedValue([{ value: 1 }]),
    patient: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ ...patientRow }),
      update: jest.fn().mockResolvedValue({ ...patientRow }),
      findFirst: jest.fn().mockResolvedValue({ ...patientRow }),
    },
    admission: { findFirst: jest.fn().mockResolvedValue(null) },
    visit: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null) },
    patientDocument: { count: jest.fn().mockResolvedValue(0) },
    complaint: { count: jest.fn().mockResolvedValue(0) },
    diagnosis: { count: jest.fn().mockResolvedValue(0) },
    prescription: { count: jest.fn().mockResolvedValue(0) },
    invoice: { aggregate: jest.fn().mockResolvedValue(zeroAgg) },
  };
}

function makeService() {
  const prisma = {
    forTenant: jest.fn((_tid: string, cb: (tx: any) => any) => cb(fakeTx())),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const files = { presignRef: jest.fn().mockResolvedValue(null) };
  const service = new PatientsService(prisma as any, audit as any, files as any);
  return { service, prisma, audit, files };
}

describe('PatientsService create/update authorization coupling (NN10)', () => {
  it('create() succeeds for a registrar even if getOne() would throw', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'getOne').mockRejectedValue(new Error('getOne must not be called by create()'));

    const res = await service.create(
      { tenantId: 't1', userId: 'u1', role: 'RECEPTIONIST' } as any,
      { firstName: 'Ada', lastName: 'Lovelace' } as any,
    );

    expect(res.id).toBe('p1');
    expect(service.getOne).not.toHaveBeenCalled();
  });

  it('update() succeeds for an editor even if getOne() would throw', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'getOne').mockRejectedValue(new Error('getOne must not be called by update()'));

    const res = await service.update(
      { tenantId: 't1', userId: 'u1', role: 'RECEPTIONIST' } as any,
      'p1',
      { firstName: 'Ada B.' } as any,
    );

    expect(res.id).toBe('p1');
    expect(service.getOne).not.toHaveBeenCalled();
  });

  it('getOne() still enforces patient:read', async () => {
    const { service } = makeService();
    await expect(
      service.getOne({ tenantId: 't1', userId: 'u1', role: 'PHARMACIST' } as any, 'p1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('create() is still gated by patient:register', async () => {
    const { service } = makeService();
    await expect(
      service.create({ tenantId: 't1', userId: 'u1', role: 'PHARMACIST' } as any, { firstName: 'X', lastName: 'Y' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
