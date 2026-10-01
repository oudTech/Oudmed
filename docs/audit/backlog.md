# Backlog

Non-Critical findings surfaced while working through the pre-launch fix list.
Logged here instead of fixed immediately, per the Phase 1 scope freeze
(2026-09-30). Only a Critical finding (cross-tenant/role data leak, wrong
money, or patient safety) gets fixed on sight instead of logged.

| ID | Description | Severity | File:line |
|---|---|---|---|
| BL-1 | `NEXT_PUBLIC_STORAGE_ORIGIN` is now an orphaned env var: `apps/web/next.config.js` no longer reads it (image optimization was disabled globally for SEC-2, see the file's own comment), but it's still documented/provisioned in `render.yaml`, `fly.toml`, `apps/web/.env.example`, `.github/workflows/ci.yml`, `apps/web/Dockerfile`, and `docs/DEPLOY.md`. No functional impact (harmless if left set), but worth a real cleanup pass across those 6 files once the Next 15 upgrade (which will re-enable image optimization) either restores its use or a decision is made to remove it for good. | Low | `apps/web/next.config.js` |
| BL-2 | **Done** (follow-up round after Batch A). PROD-4 sweep: the four remaining local-time "today" boundaries now use `common/lagos-time.ts` too - `platform-overview.service.ts` (new-this-month count, revenue trend buckets), `patients.service.ts` (stats), `inventory.service.ts` (stats, plus the drug-expiry cutoff itself: a batch is now excluded from FEFO dispensing from the start of its printed expiry date in Lagos time, not the exact instant), `home.service.ts` (today's widgets, plus the dashboard's "next up at HH:MM" time was rendering in the server's own timezone - now explicitly `Africa/Lagos`). Tested in `lagos-time.spec.ts` and the new `pharmacy/expiry-lagos.int-spec.ts`. | Low | closed |
| BL-3 | Timezone is hardcoded to Africa/Lagos (`common/lagos-time.ts`'s fixed +1h, no-DST arithmetic) across reports, schedule, pharmacy expiry, and the dashboard. Correct and fine while every hospital is in Nigeria, but it must change to a real per-tenant timezone (`Tenant.timezone` + an IANA-aware date library, since a DST-observing timezone can't use the fixed-offset shortcut lagos-time.ts relies on) before onboarding any hospital outside Nigeria. | Low | `apps/api/src/common/lagos-time.ts` |
| BL-4 | F2 (pay-before-dispense) design review: a dedicated pharmacy-only invoice was considered as an alternative to the approved whole-invoice payment gate (a patient must clear the entire invoice, including unrelated charges, to release gated drugs). Feasible at moderate code cost (a category-filtered variant of `resolveOpenInvoiceForVisit`), but doubles the open-invoice count per gated visit and fragments the one-invoice-per-visit model FUNC-2 was built around. Approved to defer; revisit if the whole-invoice constraint proves to be real friction once F2 is in use. | Low | `docs/features/F2-pay-before-dispense.md` |

## Product-scope items (not Phase 1 - separate roadmap tracks)

Scope change (2026-10-01): inpatient/admissions billing, the per-hospital
"require payment before dispensing" setting, and bulk patient import were
promoted out of this list and into Phase 1 as launch blockers - see F1, F2,
F3 in `docs/audit/phase1-status.md` and their design docs under
`docs/features/`. OudHealth must support both outpatient and inpatient care
at launch; "v1 is outpatient-only" no longer applies anywhere in these docs.

- Per-payer/HMO tariffs - every charge uses one catalogue price today
  regardless of payer (`docs/audit/pricing-notes.md`). A real schema-level
  feature (a `Tariff`/`PriceListEntry` concept), not a quick patch. Still a
  later-release item, not Phase 1.
