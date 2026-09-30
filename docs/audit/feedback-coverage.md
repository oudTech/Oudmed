# Feedback coverage checklist

Source: UX/feedback audit, pre-launch review (2026-09-30). This is the working
checklist for the toast/feedback standardization pass (Phase 1, item 7). Update
a row's status inline as it's fixed; don't delete rows.

Not audited in depth by the source pass (still needs a first look when reached):
admin's Insurance/Providers tab, platform settings' Maintenance Mode / General /
Pricing / Admin-account tabs, platform analytics page, the patients list page
itself, forgot/reset-password and verify-email pages, support/help pages.

**Positive baseline finding:** a repo-wide grep for `alert(`, `window.confirm(`,
and bare `confirm(` across all of `apps/web` returned zero hits. Every
destructive action correctly uses the shared `useConfirm()`. The gap is
"missing feedback after the dialog," not "wrong dialog system."

## Coverage table

| Module | Action | Pending | Success specific | Error specific | Disabled explained | Notes |
|---|---|---|---|---|---|---|
| HR | Add user | Y | N | Y (server msg) | N-A | `AddUserModal.tsx` closes silently on success, no toast (line 38-42) |
| HR | Edit staff / toggle active / set password | Y | N | Y (server msg) | N-A | `StaffDetailDrawer.tsx`; password-set does show inline "Password updated." (line 222) - best of the three |
| Patients | Registration wizard (8 steps) | Y | Partial | Y (server msg) | Y (RHF field errors) | Good per-field errors via Zod; no scroll-to-first-error; no unsaved-changes warning; dedupe search failure looks like "no duplicate" (UX-11) |
| Patients | Quick-add patient | Y | Partial (navigates to chart) | Y | N | `QuickAddModal.tsx` disabled button has no reason shown |
| Patients | Edit clinical history / photo upload | Y | Y (history) / N (photo) | Y (history) / N (photo) | N-A | Photo upload (`PatientPhoto`, page.tsx:695-698) has zero error path (UX-12) |
| Patients | Add document / delete document | Y | N / N | Y (toast) | N-A | Documents section is the best example of toast use in the app (page.tsx:729-782) |
| Patients | Pay invoice (from chart) | Y | N (no receipt shown) | N (generic) | N | Inconsistent with billing's own payment modal which shows a receipt |
| Schedule | Book appointment | Y | N | Y (specific, incl. clash codes) | N | `NewAppointmentModal.tsx` - good error differentiation, no success toast |
| Schedule | Change status / reschedule | Y | N | Y | N-A | `AppointmentDrawer.tsx` |
| Admissions | Admit patient | Y | N | Y | N | `NewAdmissionModal.tsx` |
| Admissions | Discharge / transfer bed | Y | N | Y | Y (transfer only) | `AdmissionDrawer.tsx` |
| Wards | Add ward | Y | N | Y | N | `WardsPage.tsx` |
| Wards | Add bed / set bed status | Y (bed status) / weak (add bed) | N | N (silent) | N-A | No `onError` on either mutation |
| Encounters | Add presenting complaint | Y | N | N (silent) | N-A | Zero error path at all - UX-3 |
| Encounters | Record vitals / diagnosis / prescription | Y | N | Y (generic "Could not save.") | N (multi-cond) | `clinicalModals.tsx`; vitals is FUNC-3 |
| Encounters | Order investigation | Y | N | Y (generic) | N | `OrderModal` |
| Encounters | Cancel investigation order | Y | N | N (silent) | N-A | UX-4 |
| Encounters | Save SOAP note | Y | N | N (silent) | N-A | UX-5 - clinical documentation |
| Encounters | Complete visit | Y | N (navigates away) | N (silent) | N-A | UX-6 - also posts a billing charge |
| Lab | Enter result | Y | N | Y (generic) | N | `ResultModal` |
| Lab | Mark in progress | Y | N | N (silent) | N-A | UX-7 |
| Pharmacy | Dispense prescription | Y | N | Y (server msg) | N (row-level short-stock hint only) | `DispensingQueue.tsx` - money+stock action, closes silently on success |
| Pharmacy | Add drug / receive stock / adjust stock | Y | N | Y (receive/adjust) / Y (add) | N (multi-cond) | `AddDrugModal.tsx`, `DrugDetailModal.tsx` |
| Pharmacy | Delete inventory item | Y | N | N (silent) | N-A | UX-1 |
| Pharmacy | Import drugs CSV | Y | Y (created/updated/skipped counts) | N (silent) for request failure | N | `ImportDrugsModal.tsx` - good result summary, but only if the request itself succeeds; UX-2 |
| Billing | Create invoice | Y | Partial (navigates to invoice) | Y | N | `billing/new/page.tsx` |
| Billing | Record payment | Y | Y (opens printable receipt) | Y | N | `RecordPaymentModal.tsx` - best pattern in billing |
| Billing | Reverse payment / cancel invoice / raise claim | Y | N (badge/list updates only) | Y (inline) | N | `InvoiceDetailDrawer.tsx` |
| Claims | Generate claims | Y | Y ("N created, N skipped") | N-A (no error path shown) | N | `GenerateClaimsModal.tsx` - good |
| Claims | Submit / write off / cancel claim | Y | N | Y | N | `ClaimDetailDrawer.tsx` |
| Claims | New batch / submit batch | Y | N | Y | N | `BatchesTab.tsx`, `BatchDetailDrawer.tsx` |
| Claims | Close batch / remove claim from batch | Y | N | N (silent) | N-A | `BatchDetailDrawer.tsx` lines 42-49 |
| Claims | Export batch schedule CSV | Y (spinner) | N | N (unhandled rejection) | N-A | try/finally with no catch - UX-8 |
| Claims | Record remittance | Y | N (drawer just closes) | Y | N | `RecordRemittanceModal.tsx` |
| Admin | Add/edit department, service | Y | N | Y | N (multi-cond) | `DepartmentsTab.tsx`, `ServicesTab.tsx` |
| Admin | Toggle active / delete | N (no per-row spinner) | N | Delete: Y / Toggle: N (silent) | N-A | `AdminRowActions.tsx` handles delete well, toggle has zero error handling |
| Settings | Hospital profile / documents numbering | Y | N (inline "Saved.") | Y | N (multi-cond) | `settings/page.tsx` |
| Settings | Upload/remove logo | Y | N | Y (upload) / N (remove) | N-A | `BrandingSection` |
| Settings | Subscription checkout (card/transfer) | Y | Y (toast, incl. Paystack-return verify) | Y (toast) | N-A | Best pattern outside platform |
| Reports | Export payment ledger CSV | Y (spinner) | N | N (unhandled rejection) | N-A | `PaymentLedger.tsx` - same bug as UX-8 (this is UX-9) |
| Platform | Add hospital | Y | N (drawer closes) | Y | N (multi-cond) | `AddHospitalModal.tsx` |
| Platform | Suspend / reactivate hospital / mark invoice paid | Y | Y (specific toasts) | N (silent) | N-A | `HospitalDetailDrawer.tsx` - best success copy in the app, but no error path at all (UX-10) |
| Platform | Add/deactivate/reactivate platform user | Y | N | Deactivate: Y (toast) / Reactivate: N | N (multi-cond) | `PlatformUsersTab.tsx` |
| Platform | Export subscriptions CSV | Y | N-A | Y (toast) | N-A | `subscriptions/page.tsx` - correctly catches the export error, the reference implementation |
| Auth | Login / signup / find-hospital | Y | N-A (redirects) | Y (specific, incl. EMAIL_NOT_VERIFIED / INVALID_CREDENTIALS) | N-A | Solid; best error differentiation in the codebase |

## Findings

### High

- [ ] **UX-1** - Delete inventory item fails silently. `apps/web/components/pharmacy/DrugDetailModal.tsx:106-113`.
- [ ] **UX-2** - CSV drug import fails silently if the request itself errors. `apps/web/components/pharmacy/ImportDrugsModal.tsx:36-43`.
- [ ] **UX-3** - Presenting complaint can silently fail to save. `apps/web/app/(protected)/encounters/[visitId]/page.tsx:336-348`.
- [ ] **UX-4** - Cancelling an investigation order fails silently. Same file, lines 399-402.
- [ ] **UX-5** - SOAP note save can silently fail. Same file, lines 464-467.
- [ ] **UX-6** - "Complete visit" has no error path. Same file, lines 55-62.
- [ ] **UX-7** - Lab "Mark in progress" fails silently. `apps/web/app/(protected)/lab/page.tsx:170-176`.
- [ ] **UX-8** - Claims batch CSV export can fail with zero feedback (unhandled rejection). `apps/web/components/claims/BatchDetailDrawer.tsx:51-54`.
- [ ] **UX-9** - Reports payment-ledger CSV export has the identical unhandled-rejection bug. `apps/web/components/reports/PaymentLedger.tsx:33-44`.
- [ ] **UX-10** - Platform hospital suspend/reactivate/mark-paid have no error path. `apps/web/components/platform/HospitalDetailDrawer.tsx:31-42`.
- [ ] **UX-11** - Patient-duplicate check misreports failure as "no duplicate found." `apps/web/app/(protected)/patients/new/page.tsx:399-424`.
- [ ] **UX-12** - Patient photo upload has no error path. `apps/web/app/(protected)/patients/[id]/page.tsx:695-698`.

### Medium

- [ ] **M1** - Silent multi-condition disabled-button pattern still live: `PlatformUsersTab.tsx` (`AddPlatformUserModal`, line 91), `AddHospitalModal.tsx` (lines 29-33), `ServicesTab.tsx` (`ServiceModal`, line 130).
- [ ] **M2** - Most of the app has no specific success confirmation, only a UI refresh (HR, pharmacy, billing, schedule/admissions, wards, admin).
- [ ] **M3** - Disabled buttons essentially never explained via tooltip/title, except `StaffDetailDrawer.tsx:167`.
- [ ] **M4** - Admin row Activate/Deactivate toggle has no per-row pending state or error handling. `AdminRowActions.tsx`.
- [ ] **M5** - Two inconsistent payment-recording surfaces: `RecordPaymentModal.tsx` (receipt) vs `PayInvoiceModal` in `clinicalModals.tsx:504-566` (silent close).
- [ ] **M6** - Billing's reverse-payment/cancel-invoice/raise-claim confirm only via badge color change. `InvoiceDetailDrawer.tsx`.
- [ ] **M7** - No scroll/focus to the first invalid field in the patient registration wizard.
- [ ] **M8** - No unsaved-changes warning anywhere (registration wizard, SOAP note editor's `dirty` flag is computed but unused).
- [ ] **M9** - Settings "Remove logo" (`settings/page.tsx:136`) and Wards add-bed/bed-status (`wards/page.tsx:53-60,171-174`) mutations have no onError.

### Low

- [ ] **L1** - Toast placement/behavior doesn't match the target standard (bottom-center, fixed 4000ms for all tones, color-only distinction). `apps/web/components/ui/feedback.tsx`.
- [ ] **L2** - `useToast`/`useConfirm` adopted in only ~13 files; pharmacy, billing, claims, schedule, wards, admin rely on inline red text instead.
- [ ] **L3** - Error messages never distinguish "no network" from "server rejected it" - every fallback is `e?.response?.data?.message ?? 'Could not save.'`.

## Proposed standardization (not yet implemented)

1. Reposition the toast stack to `fixed top-4 right-4`, stacking downward, with a tone icon (check / exclamation / info) so tone doesn't rely on background color alone.
2. Tone-aware dismissal: ~3500ms for info/success, ~8000ms (or manual close) for error.
3. One shared `errorMessage(e: unknown): string` helper centralizing the network/validation/server-error branching, replacing every ad-hoc `?? 'Could not save.'`.
4. Adopt `toast(errorMessage(e), 'error')` as the default `onError` for every mutation currently missing one (closes UX-1, UX-3 through UX-10, UX-12 in one mechanical pass).
5. Upgrade silent successes to specific toasts using data already on hand where cheap (M2).

This keeps `toast(message, tone)` / `confirm(opts)` signatures stable - no call-site API changes, just filling in missing calls.
