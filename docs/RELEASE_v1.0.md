# OudHealth v1.0 - launch report

Date: 2026-10-10. Tag: `v1.0`. This is the release OudHealth ships to its first
hospital on. It supersedes `v1.0-baseline` (tagged 2026-10-08, before this
round's HMO-claims investigation, F2 correction, inpatient-billing-route
addition and e2e automation).

## v1.0.2 (2026-10-12)

`MISS-10` (below, the visit-side counterpart of `MISS-9`, left open at
`v1.0.1`) is closed: `NewAppointmentModal` gained the same "Authorisation /
PA code" field (shown once an HMO patient is picked) as the admission
modal, and the schedule drawer (the visit-side equivalent of the admission
workspace) gained an inline edit control for it (`appointment:edit` - same
reasoning as the admission side, a PA code usually arrives after booking,
not at it). Unlike admissions, outpatient claim generation stays
unblocked on a missing PA code - that was always the deliberate,
documented difference between the two paths, not an oversight to close
here. `e2e/tests/t3-claims.spec.ts` (T3-15) now exercises the add-PA-code-
afterwards flow through the real UI and asserts the code lands on the
generated claim and shows in the claim drawer; a new API integration suite
(`schedule.int-spec.ts`, `claims.int-spec.ts`) covers booking with/without
a code, the permission boundary, and the claim carrying a null code
without blocking. Found and fixed in the same pass: the schedule drawer's
`visit` prop is a snapshot captured when its calendar card was clicked, not
a live query result, so the first implementation saved the PA code
successfully but kept showing the stale value until the drawer was
reopened - fixed by tracking the saved value locally in the drawer rather
than relying on the stale prop. Full API suite (54/370) and the full e2e
suite reconfirmed green after this fix; re-tagged `v1.0.2`.

## v1.0.1 (2026-10-10, same day)

Found while reviewing this report before deployment: the admission side of
`MISS-9` (below, in Known limitations as originally written) was a launch
blocker for HMO billing, not a post-launch item - every inpatient HMO claim
needed the Hospital-Admin-no-PA-code override, every time, with no way for
front-desk/admitting staff to ever enter the real PA code at all. Fixed same
day: `NewAdmissionModal` gained an "Authorisation / PA code" field (shown
once an HMO patient is picked), and the admission workspace gained an inline
edit control for it (`admission:edit` - PA codes commonly arrive mid-stay,
not at the door, so this needed to be editable after admission too, not
just enterable once). `e2e/tests/t4-admissions.spec.ts` now exercises both
through the real UI instead of a direct-database workaround. The outpatient
**visit** side of the same gap (a visit's own PA code has the identical
problem - type exists, API accepts it, no UI field anywhere) is still open,
logged separately as `MISS-10` since it's a distinct, smaller fix once
picked up. Full API suite (54/366) and full e2e suite (20 specs) reconfirmed
green after this fix; re-tagged `v1.0.1`.

## What's in v1.0, by module

**Outpatient (scheduling, encounters)** - appointment calendar with a unified
`Visit` status machine (scheduled -> checked in -> in progress -> completed,
plus cancel/no-show/reopen); the consultation workspace
(`/encounters/[visitId]`) stamps complaint, vitals, diagnosis, prescription,
clinical note (SOAP) and lab/imaging orders onto the visit; one invoice per
visit, charge capture on every clinical action; a completed/paid visit is
locked (reopen needs a reason, is audited, and routes further charges to a
supplementary invoice so a paid invoice is never mutated).

**Inpatient (admissions, wards)** - ward/bed board, admission episode
(admit, transfer, discharge, reopen for a late correction), a deposit ledger
(receipts, apply-to-bill, refund, with F1c's correction that deposits only
ever apply against the patient's own payable share, never an HMO's), daily
bed-day charges under either of two tenant-configurable rules
(`MIDNIGHT_CENSUS`/`MINIMUM_FULL_DAY`, with a short-stay setting), an interim
bill mid-stay and a final bill at discharge, discharge settlement (optional
hard gate on an outstanding balance, Hospital-Admin-only override), ward-round
notes, and a discharge summary. A discharge that leaves deposit credit over
never blocks on it - the remainder becomes a pending refund for billing to
pay out later, from either Refunds due or the new Inpatient billing route
(below).

**Pharmacy** - drug/batch inventory with FEFO (earliest-expiry-first) stock
draw-down, CSV import, a per-drug usage chart; prescribing autocompletes from
the catalogue, with an explicit off-formulary path (reason + audit required,
flagged as not affecting stock); a per-hospital "require payment before
dispensing" setting (off by default) that holds an item back until its
invoice line is paid, with an HMO co-pay item gated only on the *patient's
own* co-pay share - never the HMO's own, later-remitted share - and an
admitted or fully-HMO-covered item skipping the gate entirely; an audited
emergency-override dispense for `PHARMACIST`/`HOSPITAL_ADMIN`. The dispensing
queue now also shows the patient's recorded allergies on the row and inside
every dispense/prepare/review dialog (display only, no blocking logic).

**Billing** - invoice list with chips, date-range totals, and Pay; an ad-hoc
invoice builder from the service/drug catalogues with line- and
invoice-level discounts; payment recording (payer, method, printable
receipt), payment reversal, invoice cancel, idempotent payment submission;
every invoice-line add/edit/remove is audited and reason-gated once an
invoice is paid or claimed, with a per-invoice edit-history panel and a
tenant-wide edit-history report. A new **Inpatient billing** route
(`/billing/admissions`) gives Accountant - who holds the money permissions
but not `patient:read` - a way to take an admission deposit, apply it,
request a refund, and print the bill without the full clinical workspace;
its second view lists discharged admissions that still have an unpaid
balance or a refund owed, with the matching pay/refund actions inline.

**HMO claims** - generate a claim per eligible invoice (or, for an
admission, one claim pooling every invoice the stay produced) with the
provider's configured co-pay split; submit, batch per provider per period,
export the batch schedule as CSV, mark a batch submitted; record a
remittance against a provider with per-claim approved/paid allocation and a
shortfall-handling choice (write off or leave outstanding); a receivables
view aged by provider (0-30/31-60/61-90/90+ days) plus approved-unpaid and
rejected totals. A provider with no co-pay configured warns rather than
silently resolving to 0%.

**Reports** - financial + operational KPIs (collections, invoice count,
insurance collected, discounts, deposits held, refunds owed, inpatient
revenue, patient/appointment/staff/attendance counts), collections and
patient-trend charts, revenue by department/doctor, appointments by weekday,
ward occupancy, an admissions trend, and a combined payment ledger
(invoice payments + deposits + deposit refunds, one reconciliation view,
clearly labelled, filterable, CSV-exportable).

**Admin / settings** - services, departments, and insurance providers
(with co-pay percentage) as master data, with in-use delete guards and
audit; hospital profile, branding, logo, invoice/receipt number prefixes;
a staff directory (multi-department, initial password set by the admin, no
invite email yet) with active/inactive toggling and self/last-admin guard
rails.

**Platform console** - a separate login surface for Super Admin: tenant
list, create a new hospital, suspend/reactivate (a suspended hospital's
staff are locked out immediately), platform user management, maintenance
mode, platform-wide audit log. Not yet covered by the automated e2e suite
(`T6-E2E`, see below) - still manual-tested per `USABILITY_TEST_PLAN.md`.

**Cross-cutting** - every tenant table is isolated by PostgreSQL Row-Level
Security, enforced by connecting as a non-superuser role (`oudhealth_app`);
every permission check (`assertCan`/`can`) is mirrored API-side and web-side
with a drift spec that fails the build if they diverge; a JWT is re-checked
on every request so a deactivation or role change takes effect immediately,
not at next login; role-aware onboarding tours and a first-run checklist;
a global toast/feedback system (no bare `alert()`/`confirm()` anywhere).

## Fixes made since the last audit round (one-line each)

These are the fixes made in the final pre-v1.0 push - the HMO-claims
investigation, the F2 correction it led to, the nav-permission gap found
while automating e2e coverage, and the Accountant navigation gap found
while confirming it:

- `9e92d63` - claims cache wasn't invalidated after generating an admission
  claim, so a newly generated claim could exist correctly in the database
  but not show up on `/claims` until something unrelated forced a refetch.
- `3fe4bfb` - **the Critical finding this round's investigation was about**:
  `Visit.insuranceProviderId` was left `null` at visit creation even for a
  real HMO patient, so the provider-filtered Generate Claims picker never
  found the invoice. Root cause of "HMO claims not reflecting."
- `699b92a` - co-pay was silently resolving to 0% (patient pays nothing) for
  a real visit under certain provider-matching conditions, instead of
  warning or using the provider's configured percentage.
- `e8c30dc` / `b1dc56d` - `InsuranceProvider` was missing a co-pay field
  entirely in the admin UI; added it, and added a warning when a provider
  has no co-pay configured rather than resolving silently to 0%.
- `6c8caeb` / `e041955` - **F2 correction (approved)**: the co-pay release
  gate changed from a quantity split (part of the item releases immediately,
  part waits) to holding the **whole item** until the patient's own payable
  share is paid, and that release gate now waits only on the patient's own
  co-pay share - never on the HMO's own, later-remitted share - so a cash
  patient still needs the full invoice paid, but an HMO co-pay patient
  releases on paying their smaller share alone.
- `8520922` / `e2292fc` - HR/Reports/Claims/Admin and Settings had no
  permission gate on their nav entries at all - every role saw the links,
  though the pages themselves were always correctly gated server-side
  (menu visibility only, never a real data-access hole).
- `0662d62` / `50d0291` - Accountant held `admission:deposit`/
  `admission:deposit-refund` but not `patient:read`, so every admission
  money screen except two (the bill view, Refunds due) had no route in for
  that role. Added `/billing/admissions` (gated on `billing:manage`, not
  `patient:read`) with both a current-admissions view (deposit/apply/
  refund/print) and a discharged-admissions-with-money-owed view (pay the
  balance, pay out the refund, print the final bill).
- `50d0291` - the pharmacy dispensing queue never showed a patient's
  recorded allergies anywhere on screen, despite the field existing on the
  chart; now shown on the queue row and in every dispense/prepare/review
  dialog.
- `a29816d` through `6537e9e` - built the Playwright e2e harness and
  automated 17 of the 19 go-live smoke cases plus 3 bonus cases proving
  this round's own fixes (see Test status below); wired into CI.

## Known limitations

- **F3 (bulk patient import)** is designed (`docs/features/F3-bulk-import.md`)
  but not built. Staff register patients one at a time through the wizard.
- **Timezone is hardcoded to Africa/Lagos** (fixed UTC+1, no DST) across
  reports, scheduling, and pharmacy expiry. Fine while every hospital is in
  Nigeria; blocks onboarding one outside it (`BL-3`).
- **No per-HMO tariffs** - every charge uses one catalogue price regardless
  of payer. A hospital whose HMO contracts specify different rates than its
  cash price cannot reflect that today.
- **Platform console has no automated test coverage yet** (`T6-E2E`) - the
  only 2 of the 19 go-live smoke cases not in the Playwright suite. Manual-
  tested per `USABILITY_TEST_PLAN.md`.
- **No session revocation** (`SEC-3`) and **no MFA on the platform console**
  (`SEC-4`) - both Medium severity, both have a documented workaround
  (deactivate the account; keep the operator list small), neither blocks
  launch.
- Full list, with severity, risk, workaround and effort for every open
  item: `docs/audit/WHATS_LEFT.md`.

## `WHATS_LEFT.md` summary by severity

No Critical or High items are open - a Critical finding would have been
fixed before this report, per this round's own working rule; nothing met
that bar.

| Severity | Count | Examples |
|---|---|---|
| Medium | 10 | SEC-3 (session revocation), SEC-4 (platform MFA), SEC-7 (security headers), FUNC-5 (remittance advisory lock), MISS-4/6/7 (note history, patient deactivate, chart-read audit), F3 (bulk import), per-HMO tariffs, no provider-independent backup |
| Low-Medium | 1 | MISS-8 (no self-serve data export) |
| Low | 18 | SEC-6 (CSV formula injection), BL-1/3/4, F2-DECISION (a logged design trade-off, not a defect), T6-E2E, in-memory rate limiting, JWT rotation, Next.js 15 upgrade, unverified web Docker build, 5 feedback/UX polish items, 2 platform UX reports, 1 RLS-comment cosmetic gap |

29 open items total, across Security, Correctness, Missing features,
Product-scope decisions, Infrastructure/operations, and Feedback/UX
polish. `WHATS_LEFT.md` also carries a recommended post-launch order.

## Test status

**Unit/integration** (`apps/api`, real Postgres + MinIO via Docker, no
mocks): **54 suites, 370 tests**, all passing.

**End-to-end** (`e2e/`, Playwright, real browser + real API + real
Postgres): **20 specs** - 17 of the 19 go-live smoke cases from
`USABILITY_TEST_PLAN.md` (T6-01/T6-04, the platform console, are the only
2 not automated) plus 3 cases added beyond the 19 to prove this round's own
fixes (the strengthened T3-15 co-pay-split check, the F2 HMO co-pay release
case, and the Inpatient billing route case). Confirmed stable across
**3 consecutive fresh-database runs** (`docker compose down -v`, migrate,
`db:setup-role`, `prisma:rls`, seed, `pnpm test:all`) - no flaky failures.
Wired into CI (`.github/workflows/ci.yml`) against a fresh Postgres service
container on every push/PR, same sequence.

**Usability test plan** (`docs/audit/USABILITY_TEST_PLAN.md`/`.csv`):
82 cases across 6 connected tester tracks plus a feedback spot-check
section, covering outpatient cash/HMO, inpatient cash/HMO, pay-before-
dispense, supplementary invoices and line edits, the full claims
lifecycle, reports, admin/settings, and the platform console. The 19
go-live cases are a marked subset of these 82; the other 63 (deeper
coverage within each track, plus the feedback spot-check) remain
manual-tested. F3 has no cases yet since it isn't built.
