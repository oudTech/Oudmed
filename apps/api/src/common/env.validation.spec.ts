import { Logger } from '@nestjs/common';
import { validateEnv } from './env.validation';

beforeAll(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
afterAll(() => jest.restoreAllMocks());

const base = () => ({
  DATABASE_URL: 'postgresql://oudhealth:pw@localhost:5432/oudhealth',
  APP_DATABASE_URL: 'postgresql://oudhealth_app:pw@localhost:5432/oudhealth',
  JWT_SECRET: 'x'.repeat(40),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'oudhealth-dev',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
});

describe('validateEnv', () => {
  it('passes a well-formed dev environment', () => {
    expect(() => validateEnv(base() as any)).not.toThrow();
  });

  it('throws when a required var is missing', () => {
    const env = base();
    delete (env as any).JWT_SECRET;
    expect(() => validateEnv(env as any)).toThrow(/JWT_SECRET is required/);
  });

  it('throws on a short JWT_SECRET', () => {
    expect(() => validateEnv({ ...base(), JWT_SECRET: 'tooshort' } as any)).toThrow(/at least 32/);
  });

  it('rejects a placeholder JWT_SECRET in production', () => {
    const env = { ...base(), NODE_ENV: 'production', APP_PROTOCOL: 'https', APP_ROOT_DOMAIN: 'oudmed.com', JWT_SECRET: 'change-me-in-production-min-32-characters' };
    expect(() => validateEnv(env as any)).toThrow(/placeholder/);
  });

  it('requires a distinct APP_DATABASE_URL in production', () => {
    const env = {
      ...base(),
      NODE_ENV: 'production',
      APP_PROTOCOL: 'https',
      APP_ROOT_DOMAIN: 'oudmed.com',
      APP_DATABASE_URL: base().DATABASE_URL,
    };
    expect(() => validateEnv(env as any)).toThrow(/APP_DATABASE_URL must differ/);
  });

  it('only warns (does not throw) when APP_DATABASE_URL is unset in dev', () => {
    const env = base();
    delete (env as any).APP_DATABASE_URL;
    expect(() => validateEnv(env as any)).not.toThrow();
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...base(), DATABASE_URL: 'mysql://x' } as any)).toThrow(/postgres/);
  });

  it('rejects a non-numeric FILE_MAX_MB', () => {
    expect(() => validateEnv({ ...base(), FILE_MAX_MB: 'abc' } as any)).toThrow(/FILE_MAX_MB/);
  });
});
