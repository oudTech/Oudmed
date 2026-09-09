import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
afterAll(() => jest.restoreAllMocks());

const mkPrisma = (ok: boolean) => ({
  $queryRaw: jest.fn(() => (ok ? Promise.resolve([{ '?column?': 1 }]) : Promise.reject(new Error('db down')))),
});
const mkStorage = (ok: boolean) => ({
  ping: jest.fn(() => (ok ? Promise.resolve() : Promise.reject(new Error('bucket unreachable')))),
});

describe('HealthController', () => {
  it('liveness returns ok status without touching dependencies', () => {
    const ctrl = new HealthController(mkPrisma(true) as any, mkStorage(true) as any);
    expect(ctrl.check().status).toBe('ok');
  });

  it('readiness returns ready when db and storage are reachable', async () => {
    const ctrl = new HealthController(mkPrisma(true) as any, mkStorage(true) as any);
    const res = await ctrl.ready();
    expect(res.status).toBe('ready');
    expect(res.checks).toEqual({ database: 'ok', storage: 'ok' });
  });

  it('readiness throws 503 with per-check detail when a dependency is down', async () => {
    const ctrl = new HealthController(mkPrisma(true) as any, mkStorage(false) as any);
    await expect(ctrl.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
