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

## Remaining, in order

| Item | What | Status |
|---|---|---|
| 9 | Invoice line-edit UI (MISS-2), including supplementary-invoice and claim-lock behaviour | Not started |
| 10 | Printable prescriptions and lab results (MISS-5) | Not started |
| 7 | Toast/feedback pass, sub-steps (a)-(f); include supplementary-invoice notice in dispense/order success toasts | Not started |
| Final | Regression pass + launch report (done/backlog/known limitations) | Not started |

## Definition of done (per the user's own bar)

All items above complete, all tests passing, no open Critical findings, and
the full 44-case usability test plan (Testers 1-4) passes on staging.

## New findings since the scope freeze

See `docs/audit/backlog.md` - nothing Critical found so far, two Low items
logged (BL-1, an orphaned env var from the image-hardening fix; BL-2, four
more "today" boundary call sites that want the same Lagos-time fix Batch A
applied to reports/schedule).
