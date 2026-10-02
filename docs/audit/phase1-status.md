# Phase 1 status

Updated after each report. Source of truth for "is Phase 1 done yet" -
read this before assuming status from chat history, which decays fast.

## Done

| Item | What | Status |
|---|---|---|
| 1 | Security dependencies (SEC-1, SEC-2) | **Done.** `next-auth` bumped `5.0.0-beta.31` -> `5.0.0-beta.32` (no stable `5.0.0` exists on npm - still beta-only, `beta` dist-tag is `5.0.0-beta.32` as of this check). `next.config.js` images set to `unoptimized: true` globally (was per-usage only) to close the AVIF RCE path regardless of future code changes. Web dev server now binds `127.0.0.1` only (`apps/web/package.json`), noted in README. Next.js 15.5.24+ upgrade itself is **Phase 2 item 1**, not this item - the two criticals aren't reachable today (confirmed: prod is Docker/Linux via Render, so the Windows RCE doesn't apply; every real `<Image>` usage of remote content already used `unoptimized` before this change). |
| 2 | Backups (PROD-1) | **Done, pending the 24h drill.** `apps/api/prisma/dr-drill.ts` + runbook in `docs/OPERATIONS_GUIDE.md`. Neon plan upgrade is the user's own action; drill 1 and the +24h drill 2 are tracked in memory (`project_dr_drill`), not yet confirmed run. |
| 3 | Pharmacy price integrity (FUNC-1) | **Done.** `Drug.sellPrice` authoritative; override needs `billing:manage` + reason, audited; zero-price blocks the dispense. |
| 3b | Clinical order price integrity (FUNC-1 sweep) | **Done.** Same pattern applied to `createOrder`. Full sweep of every charge-creation path recorded in `docs/audit/pricing-notes.md` - only these two were vulnerable. |
| 3c | Off-formulary handling | **Done** (verified present, not just recalled): reason+audit required for off-formulary dispensing and free-text orders (`OFF_FORMULARY_DISPENSE` / `OFF_CATALOGUE_ORDER`); prescribing UI shows a "did you mean" confirmation before a typed drug can become off-formulary; dispensing UI requires a reason and labels off-formulary rows as not affecting stock; `GET /pharmacy/off-formulary-report` + a panel on the Inventory tab. |
| 4 | Completed-visit / paid-invoice guard (FUNC-2) | **Done.** Reopen (`visit:reopen`, attending doctor or admin, reason, audited); orders/prescriptions/note-edits blocked on a completed visit, complaint/vitals/diagnosis stay available and labelled late; `ClinicalNoteAddendum` for late notes; supplementary invoices (`Invoice.isSupplementary`) when the primary is locked by a payment or claim; `updateInvoice`/`removeInvoiceLine` now also correctly block on an existing claim (a gap found while building this); claims generate per-invoice now; billing reopen-flag + explicit Acknowledge. |
| Batch A | FUNC-3 (vitals validation), FUNC-4 (patient-reg coercion retest), production essentials (Sentry privacy/context, reset-email failure logging, Africa/Lagos day boundaries), known issue #6 (suspended hospital), known issue #5 (ledger date range) | **Done.** Weight was already `Decimal(5,2)` in both `Patient` and `VitalSigns` - no schema change needed; `heightCm` confirmed correctly `Int` (no sub-cm clinical need). Height/glucose field-level validation (API + UI). Sentry `sendDefaultPii: false` + `beforeSend` scrub + tenant/user/role tags only. Reset-email send failures now logged (response unchanged). New `common/lagos-time.ts` (fixed UTC+1, no DST) used by `reports.util.ts` and `schedule.service.ts`'s "today" default. `resolvePublic` now returns 403 `TENANT_SUSPENDED` instead of a generic 404 for a disabled hospital; login page shows a distinct "Account suspended" screen with a support CTA. Payment ledger gained a custom from/to range with `from <= to` validation (backend + UI), Lagos-aware. |
| Follow-ups | Items 1/3c re-confirmed with commit hashes; known issue #2 retest (real HTTP + ValidationPipe, steps 1-4); BL-2 (4 remaining Lagos-time call sites + drug-expiry cutoff rule); Sentry URL/breadcrumb scrubbing (API + web, web previously had none); BL-3 logged (per-tenant timezone) | **Done.** See the follow-ups report for detail; full suite green. |
| SEC-1 recheck | Confirmed (not just re-asserted) that `next-auth@5.0.0-beta.32` fixes both critical advisories (GHSA-8fpg-xm3f-6cx3, GHSA-7rqj-j65f-68wh) - GitHub's own structured advisory data gives `first_patched_version: 5.0.0-beta.32` for both, `pnpm audit` shows zero next-auth findings, `@auth/core@0.41.3` (the dependency the second advisory also covers) is installed. No stable `next-auth@5.0.0` exists yet (`npm view next-auth dist-tags` - `beta` is the only v5 tag); that does not reopen either advisory since each one's own fix version is pinned to the beta line, not to the eventual stable tag. | **Done**, no version change needed. |
| 2 (dispense expiry message) | Distinguish out-of-stock / expired-only / not-enough-unexpired in the dispense error, naming the expired batch(es) | **Done.** `OUT_OF_STOCK`, `EXPIRED_STOCK_ONLY` (names batch + expiry date), `INSUFFICIENT_STOCK` (names units available). |
| 9 | Invoice line-edit UI (MISS-2), including supplementary-invoice and claim-lock behaviour | **Done.** Add/edit/remove lines from the billing screen; blocked with a clear message once paid or claimed; a supplementary invoice is editable like any other unlocked invoice. |
| 9 addendum | Audit + required reason for invoice line edits | **Done.** Every add/edit/remove audited (who/when/invoice/line/before-after); reason required for a catalogue-price override, a discount add/increase, or any removal - not for a catalogue-priced add or a quantity-only fix. "Edited" marker + edit-history panel in the drawer; new `/billing/edits` report (date-range, `billing:manage`) for Hospital Admin review of manual price changes and discounts. |
| 10 | Printable prescriptions and lab results (MISS-5) | **Done.** A4, hospital-branded, one page per Rx or per resulted lab/imaging order; patient details, prescriber/lab staff, date. |

## Scope change (2026-10-01): inpatient care is now a Phase 1 launch blocker

OudHealth must support both outpatient and inpatient care at launch, not just
outpatient. Three features promoted from the backlog's "separate roadmap
tracks" to Phase 1 proper. Designs approved (with 5 F1 review questions
resolved, then 4 further F1 conditions resolved into the doc - see
`docs/features/F1-inpatient-billing.md`'s current content, not the chat
history). Build order: **F1 -> F2 -> F3**, F1 in four reported sub-steps.

| Item | What | Status |
|---|---|---|
| F1a | Schema/migrations, admission episode, deposits ledger (receipts + cash-report entries), inpatient workspace basics | Done |
| F1b | Daily charges (both rules + short-stay setting), transfers, charges posted during the stay, interim bill | Done |
| F1c | Discharge (settlement setting, override), final bill, deposit application and refund, discharge summary, admission reopen, admission ward-round notes. Two corrections after approval: refund-pending-never-blocks-discharge, deposits apply only to the patient-payable (non-HMO) share | Done |
| F1d | Admission claims (`generateForAdmission`, remittance generalisation, backfill verification), occupancy/inpatient revenue reports; F1 usability cases added to the test plan | **Done.** `generateForAdmission` + `resolveClaimInvoices`/`splitProportionally` generalise remittance/write-off/reversal across a multi-invoice admission claim, provably identical for every existing (single-invoice) outpatient claim; backfill-verification queries ran clean (zero orphans); full outpatient generate->batch->CSV->remittance->write-off->aging regression passes unchanged. Reports gained `occupancyByWard`, `admissionsTrend`, and an `inpatient_revenue` KPI. See `docs/features/F1-inpatient-billing.md`'s F1d implementation notes and `docs/audit/USABILITY_TEST_PLAN.md`'s T4 (inpatient) track. |
| F2 | Per-hospital setting: require payment before dispensing, with HMO/inpatient/emergency-override exemptions | **Done.** `requirePaymentBeforeDispense` (off by default); `prepare()`/`release()`/`cancel-preparation()` state machine (charge posted, stock held back until the invoice is `PAID`); co-pay splits proportionally into an immediately-dispensed covered share and a gated co-pay share; an admitted patient or an HMO-covered item skips the gate entirely; `pharmacy:dispense-emergency-override` (PHARMACIST/HOSPITAL_ADMIN) still dispenses in the old one-step way, audited, for a genuine emergency. See `docs/features/F2-pay-before-dispense.md`'s implementation notes and `docs/audit/USABILITY_TEST_PLAN.md`'s T3 (pharmacy/billing/claims) track. |
| F3 | Bulk patient import (CSV/Excel, dry run, duplicates, legacy patient numbers, undo) | Approved as designed. One report. Independent of F1/F2. |

## Remaining, in order

| Item | What | Status |
|---|---|---|
| F1a-d | See table above | F1a+F1b+F1c+F1d done |
| F2 | One report | Done |
| F3 | One report | Not started |
| 7 | Toast/feedback pass, sub-steps (a)-(f); include supplementary-invoice notice in dispense/order success toasts; cover all new F1-F3 screens | Not started |
| Final | Regression pass, extended usability test plan (original 44 cases + new F1/F2/F3 cases), launch report | Not started |

## Definition of done (per the user's own bar)

All items above complete, all tests passing, no open Critical findings, and
the full usability test plan (`docs/audit/USABILITY_TEST_PLAN.md` /
`.csv`, the 2026-10-02 rewrite - supersedes `usability-test-plan.md`) -
82 cases across 6 connected tester tracks plus a feedback spot-check
section, covering outpatient cash/HMO, inpatient cash/HMO, pay-before-
dispense, supplementary invoices and line edits, the full claims
lifecycle, reports, admin/settings, and the platform console, with a
19-case go-live smoke test marked - passes on staging. F3 (bulk import)
has no cases yet since it isn't built.

## New findings since the scope freeze

See `docs/audit/backlog.md` - nothing Critical found so far. BL-1 (orphaned
env var) still open, Low. BL-2 (remaining Lagos-time call sites) closed in
the follow-ups round. BL-3 (per-tenant timezone) still open, Low - fine
while every hospital is in Nigeria, but blocks onboarding one outside it.
BL-4 (F2's dedicated pharmacy-only invoice, deferred by approval) newly
logged, Low.
