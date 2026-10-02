# Feedback coverage checklist

Source: UX/feedback audit, pre-launch review (2026-09-30). This is the working
checklist for the toast/feedback standardization pass (Phase 1, item 7). Update
a row's status inline as it's fixed; don't delete rows.

**Status (2026-10-02): batches 1-3 done.** New toast stack (top-right, tone
icons, tone-aware dismissal - error persists ~8s or until dismissed,
success/info ~3.5s) and `toastPromise()` for slow actions (CSV export, bulk
import) with a "still working..." upgrade and an optional retry action -
`components/ui/feedback.tsx`, now wired into both CSV-export flows (claims
batch schedule, reports payment ledger). New `lib/errors.ts`'s
`errorMessage(e)` replaces the repeated `?? 'Could not save.'` fallback.
All 12 High findings (UX-1 through UX-12) fixed. Medium findings M1, M3,
M4, M5, M6, M9 fixed. M2 got representative fixes (patient registration,
HR add-user/edit/toggle-active, pharmacy dispense/prepare, appointment
booking, admission/transfer) rather than an exhaustive sweep of every
silent success across the app - the remaining spread is listed under
"Still open" below, not silently dropped. **Batch 3 specifically
re-audited the F1/F2 screens named in the brief** (admission, deposits,
discharge, transfer, pay-before-dispense): every mutation on the
admission workspace and discharge/transfer drawer already had full
error+success feedback from when those features were built - two gaps
found and closed (admit and transfer had error handling but no plain
success toast when nothing was wrong), confirming the standard holds on
the newest screens, not just the audited-in-September ones. M7 and M8 are
real UX gaps but are new interaction mechanisms (focus management,
dirty-state tracking across an 8-step wizard), not toast gaps -
deliberately deferred, tracked in `docs/audit/WHATS_LEFT.md`.

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

- [x] **UX-1** - Delete inventory item fails silently. `apps/web/components/pharmacy/DrugDetailModal.tsx` - fixed, toast on success/error, also added to `save`.
- [x] **UX-2** - CSV drug import fails silently if the request itself errors. `apps/web/components/pharmacy/ImportDrugsModal.tsx` - fixed.
- [x] **UX-3** - Presenting complaint can silently fail to save. `apps/web/app/(protected)/encounters/[visitId]/page.tsx` - fixed.
- [x] **UX-4** - Cancelling an investigation order fails silently. Same file - fixed.
- [x] **UX-5** - SOAP note save can silently fail. Same file - already had a handler by the time this pass ran; reconfirmed.
- [x] **UX-6** - "Complete visit" has no error path. Same file - already had a handler by the time this pass ran; reconfirmed.
- [x] **UX-7** - Lab "Mark in progress" fails silently. `apps/web/app/(protected)/lab/page.tsx` - fixed, plus the "Enter result" mutation next to it (same gap, not previously listed).
- [x] **UX-8** - Claims batch CSV export can fail with zero feedback (unhandled rejection). `apps/web/components/claims/BatchDetailDrawer.tsx` - fixed; `close`/`removeClaim` mutations also gained error+success feedback.
- [x] **UX-9** - Reports payment-ledger CSV export has the identical unhandled-rejection bug. `apps/web/components/reports/PaymentLedger.tsx` - fixed.
- [x] **UX-10** - Platform hospital suspend/reactivate/mark-paid have no error path. `apps/web/components/platform/HospitalDetailDrawer.tsx` - fixed.
- [x] **UX-11** - Patient-duplicate check misreports failure as "no duplicate found." `apps/web/app/(protected)/patients/new/page.tsx` - fixed: a failed check now shows its own error instead of falling through to the empty-results message.
- [x] **UX-12** - Patient photo upload has no error path. `apps/web/app/(protected)/patients/[id]/page.tsx` - fixed, plus a success toast.

### Medium

- [x] **M1** - Silent multi-condition disabled-button pattern: `PlatformUsersTab.tsx`, `AddHospitalModal.tsx`, `ServicesTab.tsx` - fixed (explanatory `title` on each).
- [~] **M2** - Most of the app has no specific success confirmation, only a UI refresh (HR, pharmacy, billing, schedule/admissions, wards, admin). Representative fixes landed: patient registration ("Patient PT-00012 registered"), HR add-user, pharmacy dispense/prepare ("Dispensed to Jane Doe" / "Prepared for ... - awaiting payment"), appointment booking, admin department/service/provider toggle, ward add-bed. **Still open**: billing invoice creation, most of HR's edit/password-set/toggle-active actions, remaining admissions/wards flows, remaining claims actions beyond what UX-8/M6 already covered - tracked in `docs/audit/WHATS_LEFT.md`, not silently dropped.
- [x] **M3** - Disabled buttons essentially never explained via tooltip/title - fixed for the three M1 cases (same root cause, same fix).
- [x] **M4** - Admin row Activate/Deactivate toggle had no error handling. Fixed (toast on error + specific success message) in `DepartmentsTab.tsx`, `ServicesTab.tsx`, `ProvidersTab.tsx`. Per-row pending indicator (vs. the existing all-rows `busy` flag) not done - cosmetic, tracked in `docs/audit/WHATS_LEFT.md`.
- [x] **M5** - Two inconsistent payment-recording surfaces. Fixed: `PayInvoiceModal` (`clinicalModals.tsx`) now shows the same `ReceiptView` `RecordPaymentModal` does, instead of closing silently.
- [x] **M6** - Billing's reverse-payment/cancel-invoice/raise-claim confirmed only via badge color change. Fixed - each now also shows a specific success toast.
- [ ] **M7** - No scroll/focus to the first invalid field in the patient registration wizard. Deferred - a new interaction mechanism, not a toast gap; tracked in `docs/audit/WHATS_LEFT.md`.
- [ ] **M8** - No unsaved-changes warning anywhere. Deferred - same reasoning as M7.
- [x] **M9** - Settings "Remove logo" and Wards add-bed/bed-status mutations had no onError. Fixed, all three.

### Low

- [x] **L1** - Toast placement/behavior now matches the target standard: top-right, tone icons, tone-aware dismissal. `apps/web/components/ui/feedback.tsx`.
- [~] **L2** - `useToast`/`useConfirm` adoption widened by this pass (pharmacy, billing, claims, reports, schedule, wards, admin, platform all gained at least one new call site) but not every remaining inline-red-text spot was converted - the ones touched now use toast consistently; a full sweep of every leftover inline error message is still open, tracked in `docs/audit/WHATS_LEFT.md`.
- [x] **L3** - `lib/errors.ts`'s `errorMessage(e)` now distinguishes unreachable-server / validation-or-server-rejected / 5xx, used everywhere this pass added a new `onError`.

## Standardization (implemented 2026-10-02)

1. Toast stack repositioned to `fixed top-4 right-4`, stacking downward, with a tone icon (check / exclamation / info) so tone doesn't rely on background color alone.
2. Tone-aware dismissal: ~3500ms for info/success, ~8000ms (or manual close) for error.
3. One shared `errorMessage(e: unknown): string` helper centralizing the network/validation/server-error branching, replacing the ad-hoc `?? 'Could not save.'` fallback everywhere this pass touched.
4. `toast(errorMessage(e), 'error')` adopted as the default `onError` for every High-severity mutation that was missing one (UX-1 through UX-12).
5. Silent successes upgraded to specific toasts where cheap, including the two patterns named in the brief (`Patient PT-00012 registered`, `Dispensed to Jane Doe`).
6. New `toastPromise()` for the handful of actions slow enough to need their own progress indicator (CSV export, bulk import) - a loading toast that upgrades in place to success/error, with a "still working..." message after 4.5s and an optional retry action.

`toast(message, tone)` / `confirm(opts)` signatures are unchanged - every existing call site kept working as-is; `toastPromise` is new and adopted only where it adds real value over a button spinner.
