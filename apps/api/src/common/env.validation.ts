import { Logger } from '@nestjs/common';

/**
 * Fail-fast environment validation. Called once from main.ts before the Nest
 * application is created, so a misconfigured deploy stops at boot with a clear
 * message instead of 500-ing every request (missing JWT_SECRET) or silently
 * running without row-level security (missing APP_DATABASE_URL).
 *
 * Kept as a plain function (no class-validator DTO) so it runs before any
 * decorator metadata is needed and has no import-order constraints.
 */

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const;

const PLACEHOLDER = /change[-_ ]?me|placeholder|example|your[-_ ]?secret|xxxxx/i;

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const log = new Logger('Env');
  const isProd = env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const key of REQUIRED) {
    if (!env[key] || !env[key]!.trim()) errors.push(`${key} is required but not set`);
  }

  if (env.JWT_SECRET) {
    if (env.JWT_SECRET.length < 32) errors.push('JWT_SECRET must be at least 32 characters');
    if (isProd && PLACEHOLDER.test(env.JWT_SECRET)) {
      errors.push('JWT_SECRET looks like a placeholder - set a real random value in production');
    }
  }

  if (env.DATABASE_URL && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
    errors.push('DATABASE_URL must be a postgres:// connection string');
  }

  // The API process must connect through the dedicated NOSUPERUSER / NOBYPASSRLS
  // role, otherwise PostgreSQL row-level security is not enforced and every
  // forTenant scope is advisory only.
  const appUrl = env.APP_DATABASE_URL?.trim();
  if (isProd) {
    if (!appUrl) {
      errors.push('APP_DATABASE_URL is required in production (RLS is bypassed on the owner connection)');
    } else if (appUrl === env.DATABASE_URL) {
      errors.push('APP_DATABASE_URL must differ from DATABASE_URL (it must be the non-superuser app role)');
    }
  } else if (!appUrl || appUrl === env.DATABASE_URL) {
    warnings.push('APP_DATABASE_URL is not set (or equals DATABASE_URL): row-level security is NOT enforced. Run `pnpm db:setup-role`.');
  }

  if (env.FILE_MAX_MB !== undefined && env.FILE_MAX_MB !== '') {
    const n = Number(env.FILE_MAX_MB);
    if (!Number.isFinite(n) || n <= 0) errors.push('FILE_MAX_MB must be a positive number');
  }

  if (isProd) {
    if (!env.APP_ROOT_DOMAIN || env.APP_ROOT_DOMAIN.includes('localhost')) {
      warnings.push('APP_ROOT_DOMAIN is unset or points at localhost in production');
    }
    if (env.APP_PROTOCOL !== 'https') warnings.push('APP_PROTOCOL is not "https" in production');
  }

  for (const w of warnings) log.warn(w);

  if (errors.length) {
    throw new Error(
      `Invalid environment configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}\n` +
        'See apps/api/.env.example. Fix these and restart.',
    );
  }
}
