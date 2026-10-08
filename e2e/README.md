# E2E smoke suite

Automates the 19 go-live smoke cases from `docs/audit/USABILITY_TEST_PLAN.md`
(the rows marked `Go-live smoke test`), plus two added during the HMO-claims/
F2 investigation (2026-10-08/09, `docs/audit/phase1-status.md`): the
strengthened T3-15 co-pay-split check, and a dedicated F2 HMO co-pay release
case. Runs against the real app (API + web) and a real Postgres, seeded into
a dedicated `e2e` tenant (`e2e/seed.ts`) - never the `demo` tenant.

## Running it

```bash
pnpm e2e              # just the e2e suite (reuses already-running dev
                       # servers locally; starts its own if none are up)
pnpm test:all          # unit + integration (apps/api) + e2e, one command
```

`e2e/global-setup.ts` runs once before the suite: destroys and recreates
the `e2e` and `e2e-suspend` tenants (`e2e/seed.ts`, idempotent), then logs
in every role once through the real UI and saves each session
(`e2e/.auth/<role>.json`) for the spec files to reuse.

No `RESEND_API_KEY` is expected to be set in this environment - the
sign-up verification-code test (T1-02/T1-03) reads the code the API logs
instead of sending a real email (`apps/api/src/email/email.service.ts`'s
documented dev-mode fallback), via `e2e/verification-code.ts` tailing the
API's redirected log output (`e2e/.tmp/api.log`).

## Architecture

Each spec file seeds its own precondition data directly via Prisma
(`e2e/fixtures.ts`'s `db`, the same role `apps/api/test/int-helpers.ts`'s
`ownerPrisma` plays for the integration suite) before driving the real UI
for the action actually under test - tests are independent, not a single
long connected script the way the manual test plan is written, so they can
run in any order and a failure in one doesn't cascade into unrelated
failures in the next.

## Status (2026-10-09)

Built and passing:

- Harness: seeding, per-role auth, the sign-up/verification-code flow,
  CI wiring (`.github/workflows/ci.yml`).
- T1-02/T1-03 (sign-up, email verification by code, hospital creation)
- T1-06 (role-based nav + direct-URL access control) - found and fixed a
  real bug while building this one: HR/Reports/Claims/Admin had no
  permission gate on their nav entries at all.
- T1-08 (patient registration wizard, steps 1-8)

Not yet written - tracked here so this list stays the source of truth
rather than scattered TODOs: T2-02, T2-07, T3-02, T3-06, T3-07, T3-10,
T3-12, T3-15 (strengthened), T3-17, T4-01, T4-05, T4-10, T4-11, T6-01,
T6-04, plus the new F2 HMO co-pay release case. The architecture above is
proven out by the first three - each remaining case is a straightforward
extension, not a new pattern.
