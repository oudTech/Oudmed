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
failures in the next. A step whose point is real server-side business
logic rather than UI interaction (e.g. resolving an HMO patient's co-pay
when a visit is created) goes through the real API directly
(`fixtures.ts`'s `apiLogin()`/`apiPost()`) instead of a browser - faster,
and it still exercises the real code path, just not through the DOM.

Two real, environment-specific problems fixed along the way, not just
worked around blindly - see the commit history for the full detail:
tenant subdomains not resolving via plain OS DNS on this machine (fixed
with a Chromium `--host-resolver-rules` launch arg), and
`components/ui/kit.tsx`'s `Field` having no label/input association at
all (`fieldInput()` in `fixtures.ts` is the documented workaround, used
throughout; the gap itself is a real, separate accessibility issue worth
fixing in the app, not just in these tests).

## Status (2026-10-09)

**12 of 19 cases verified passing**, against the real app, a real
Postgres, and a real browser - re-run with `pnpm e2e` any time to
reconfirm:

- Harness: seeding, per-role auth (UI-driven), the sign-up/verification-
  code flow, CI wiring (`.github/workflows/ci.yml`).
- T1-02/T1-03 (sign-up, email verification by code, hospital creation)
- T1-06 (role-based nav + direct-URL access control) - found and fixed a
  real bug while building this one: HR/Reports/Claims/Admin had no
  permission gate on their nav entries at all (`AppShell.tsx`).
- T1-08 (patient registration wizard, all 8 steps)
- T2-02 (check-in + record vitals)
- T2-07 (lab order + complete visit + invoice posted)
- T3-02 (dispense, gate off - control case)
- T3-06/T3-07/T3-10/T3-12 (prepare -> blocked release -> pay -> release,
  one connected sequence - confirms the 2026-10-08 whole-item-hold change
  and the 2026-10-09 patient-payable release-gate fix together, through a
  real browser)
- T3-15, strengthened (**the exact case the whole HMO-claims
  investigation was about**): an HMO patient's visit created through the
  real API so `ScheduleService.create()`'s provider resolution genuinely
  runs, not bypassed by direct seeding; confirms the provider-filtered
  Generate Claims picker finds the invoice, the generated claim's co-pay
  split matches the provider's configured percentage exactly (not
  100%/0%), and the new claim appears in the Claims list filtered by that
  same provider

**Not yet written** - tracked here so this list stays the source of
truth, not scattered TODOs. Each is a mechanical extension of the
patterns above (seed precondition data, drive the UI for the action under
test, assert via DB + UI), not a new architecture:

- T3-17 (submit -> batch -> export -> remittance -> receivables aging)
- T4-01, T4-05, T4-10, T4-11 (admission: admit, discharge clean,
  discharge with HMO co-pay deposit split, generate the admission claim)
- T6-01, T6-04 (platform console login; suspend a hospital, confirm its
  staff are locked out - `e2e-suspend` tenant exists in the seed
  specifically for this one, unused so far)
- The new F2 case: an HMO co-pay patient's drug releases once they pay
  their own share, without waiting on the HMO's - T3's
  T3-06/07/10/12 sequence already proves this mechanism for a cash
  patient; the missing piece is the same sequence for an HMO co-pay
  patient specifically, which is the scenario the 2026-10-09 fix exists
  for.
