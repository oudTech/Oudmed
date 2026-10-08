import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke suite (Step 3 of the pre-F3 punch list,
 * docs/audit/phase1-status.md) - automates the 19 go-live smoke cases
 * from docs/audit/USABILITY_TEST_PLAN.md plus two added during the
 * HMO-claims/F2 investigation (the strengthened T3-15 co-pay-split check,
 * and a dedicated F2 co-pay release case). Runs against the real app
 * (API + web), a real Postgres (via docker compose), seeded by e2e/seed.ts
 * into a dedicated `e2e` tenant - never the `demo` tenant.
 *
 * Local run: `pnpm e2e` (reuses already-running dev servers if you have
 * them up; starts its own otherwise). CI: `pnpm test:all` builds and
 * starts both apps fresh every time (see .github/workflows/ci.yml).
 */
export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false, // tests share one seeded tenant's data; order-independent but not isolated enough to parallelize safely
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // Next's dev server compiles each route on first visit - a never-before-
  // hit page (especially a brand-new tenant subdomain's very first request)
  // can genuinely take 15-20s before it even starts rendering. Playwright's
  // 30s default was too tight for that, not a sign of an actually-slow app.
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Tenant subdomains (e2e.localhost, e2e-suspend.localhost) don't
    // reliably resolve via plain OS DNS on every machine (confirmed not on
    // this one) - force every *.localhost host straight to the loopback
    // address, the same trick CI-less local dev needs regardless of OS.
    launchOptions: {
      args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      // Output redirected to a fixed, Node-resolvable path so
      // e2e/verification-code.ts can read a dev-mode logged verification
      // code (no RESEND_API_KEY in this environment - see
      // apps/api/src/email/email.service.ts) without needing a real inbox.
      command:
        process.platform === 'win32'
          ? 'cmd /c "pnpm --filter @oudhealth/api run start:dev > e2e\\.tmp\\api.log 2>&1"'
          : 'pnpm --filter @oudhealth/api run start:dev > e2e/.tmp/api.log 2>&1',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      cwd: __dirname,
    },
    {
      command: 'pnpm --filter @oudhealth/web run dev',
      url: 'http://localhost:3001',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      cwd: __dirname,
    },
  ],
});
