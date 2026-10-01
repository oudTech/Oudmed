# Backlog

Non-Critical findings surfaced while working through the pre-launch fix list.
Logged here instead of fixed immediately, per the Phase 1 scope freeze
(2026-09-30). Only a Critical finding (cross-tenant/role data leak, wrong
money, or patient safety) gets fixed on sight instead of logged.

| ID | Description | Severity | File:line |
|---|---|---|---|
| BL-1 | `NEXT_PUBLIC_STORAGE_ORIGIN` is now an orphaned env var: `apps/web/next.config.js` no longer reads it (image optimization was disabled globally for SEC-2, see the file's own comment), but it's still documented/provisioned in `render.yaml`, `fly.toml`, `apps/web/.env.example`, `.github/workflows/ci.yml`, `apps/web/Dockerfile`, and `docs/DEPLOY.md`. No functional impact (harmless if left set), but worth a real cleanup pass across those 6 files once the Next 15 upgrade (which will re-enable image optimization) either restores its use or a decision is made to remove it for good. | Low | `apps/web/next.config.js` |
| BL-2 | PROD-4 sweep: Batch A fixed the two date-boundary call sites item 8/12 named (`reports.util.ts`, `schedule.service.ts`), via the new shared `common/lagos-time.ts` helper. Four more call sites still use the server's own local timezone for a `setHours(0,0,0,0)` / `setHours(23,59,59,999)` "today" boundary and were out of the approved Batch A scope: `platform/platform-overview.service.ts`, `patients/patients.service.ts`, `pharmacy/inventory.service.ts`, `home/home.service.ts`. Same fix pattern applies - swap in `startOfDayLagos`/`addDaysUtc`. | Low | see file list above |

## Product-scope items (not Phase 1 - separate roadmap tracks)

- Inpatient/admissions billing - targeted for the next release; v1 is
  outpatient-only. See `docs/audit/pricing-notes.md` for what currently
  exists (nothing charges for a bed-day today).
- Per-hospital setting: require payment before dispensing. Not built; today
  nothing gates dispensing on payment status (confirmed while investigating
  FUNC-2's item 1). A configurable per-tenant toggle, not a hardcoded rule.
- Bulk patient import for onboarding a new hospital - early Phase 2, needed
  so a hospital with existing digital records isn't forced through the
  8-step wizard per patient. Depends on confirming with the hospital whether
  they have existing digital records to import.
- Per-payer/HMO tariffs - every charge uses one catalogue price today
  regardless of payer (`docs/audit/pricing-notes.md`). A real schema-level
  feature (a `Tariff`/`PriceListEntry` concept), not a quick patch.
