# Usability test plan

Manual, click-through test cases run on staging before launch - this is
distinct from the automated integration/unit suite (`pnpm test`), which
checks the code is correct; this plan checks the *product* is usable by
someone who has never read the code. Referenced as "the test plan" / "the
usability test plan" in `docs/audit/phase1-status.md`'s definition of done.

**Status note on cases 1-44**: the original 44 outpatient/general cases
(registration, scheduling, encounters, pharmacy, billing, claims, HR,
admin, reports, onboarding) were defined and tracked during the pre-launch
audit phase of this project, before this file existed. They are not yet
transcribed into this repo - do not invent their content. Before the
"Final" regression pass in `phase1-status.md`, pull them from that audit's
original record and paste them in above the F1 section below, renumbered
1-44 as they were originally defined. The cases below (F1) are complete and
ready to run as-is.

## F1: inpatient admissions and billing

Run against a seeded staging tenant with at least one active ward with two
beds, one `InsuranceProvider` configured with a `defaultCoPayPct`, and both
a NURSE and an ACCOUNTANT/HOSPITAL_ADMIN demo login.

| # | Case | Steps | Expected |
|---|---|---|---|
| F1-1 | Admit a patient | From a patient's chart, start Admit; pick a ward, an available bed, admission type | Admission created, status Admitted; the bed shows Occupied on the ward/bed picker for any other patient |
| F1-2 | Take a deposit | On the new admission, Add deposit (cash) | Receipt shown/printable; deposit appears on the admission and in Reports > payment ledger tagged "Deposit", not counted in Total Collection |
| F1-3 | Inpatient workspace charges | From the admission workspace, add a service charge (e.g. a lab order) | Charge lands on the admission's own invoice, not a visit's; appears on the interim bill |
| F1-4 | Interim bill, mid-stay | Open "Interim bill" from the admission | Printable A4, labelled "Interim bill - stay in progress"; running totals (charged, deposited, balance) match what was entered so far |
| F1-5 | Transfer wards | Transfer the patient to a different ward/bed | Old bed frees to Available, new bed shows Occupied; ward-stay history on the admission shows both stays with no gap or overlap |
| F1-6 | Nightly bed charge | Let (or trigger in staging) the nightly job run overnight | One bed-day line posted at the correct ward's current rate for each night stayed, attributed to whichever ward was active that night |
| F1-7 | Discharge, balance clears clean | With no outstanding balance and no leftover deposit, discharge the patient | Status becomes Discharged; final bill totals match the interim bill plus the last partial night; no pending-refund banner anywhere |
| F1-8 | Discharge with unpaid balance, setting on | With `requireSettledBillAtDischarge` enabled and a real unpaid balance, attempt discharge as a non-admin | Blocked with a clear message naming the outstanding amount |
| F1-9 | Discharge override | Same unpaid balance, discharge as HOSPITAL_ADMIN with an override reason | Discharge succeeds; override reason visible in the admission's audit trail |
| F1-10 | Discharge with deposit credit left, refund pending | Admit, deposit more than the final bill, discharge without choosing an immediate refund method | Discharge completes immediately (never blocked); the admission shows "Refund pending" with the correct amount; it also appears on the Refunds due list for billing/cashier |
| F1-11 | Pay out a pending refund | From the Refunds due list, pay out the refund from F1-10 | Refund receipt issued; cash-ledger entry appears in the payment ledger tagged "Deposit refund"; the admission no longer shows as pending; attempting to pay the same refund again is not possible |
| F1-12 | Discharge with immediate refund | Admit, deposit more than the bill, discharge choosing "refund now" with a method | Refund receipt issued in the same action, no separate pending step; no entry appears on Refunds due |
| F1-13 | HMO deposit applies to patient share only | Admit an HMO patient with a co-pay percent configured, take a deposit larger than the patient's own share of the bill, discharge | Only the patient-payable portion (co-pay) is drawn from the deposit; the remainder shows as a refund (pending or paid per the chosen option), never silently absorbed into the HMO's expected portion |
| F1-14 | Reopen after discharge | Reopen a discharged admission, add a late note/result | Clinical entry succeeds without reverting the Discharged status or re-occupying the bed; a late charge lands on a new supplementary invoice since the discharge-time invoices are locked |
| F1-15 | Discharge summary | Open the discharge summary for a completed admission | Diagnoses, prescriptions, notes and final bill totals all present; printable A4 |
| F1-16 | Generate an HMO admission claim | Discharge an HMO admission with a pre-authorization code set, generate its claim | One claim created spanning every invoice the stay produced (primary plus any supplementary), claimed/patient-responsibility amounts match the co-pay split |
| F1-17 | Claim blocked while still admitted | Attempt to generate a claim for an admission that has not been discharged yet | Blocked with a clear message that the bill is not final yet |
| F1-18 | Claim blocked without a pre-auth code | Attempt to generate a claim for a discharged admission with no authorization code set | Blocked with a clear message that a pre-authorization code is required |
| F1-19 | Batch, submit, export the admission claim | Add the F1-16 claim to a batch, submit it, export the schedule CSV | Claim appears correctly in the batch and the CSV, same as an outpatient claim |
| F1-20 | Remit an admission claim across multiple invoices | Record a remittance paying the F1-16 claim in full, where the stay produced more than one invoice | Payment splits correctly across every invoice the claim covers, not just the first one; each invoice's own balance updates |
| F1-21 | Reverse that remittance | Reverse the F1-20 remittance | Every split payment is reversed (not just one), each invoice's balance reverts, the claim returns to Submitted |
| F1-22 | Write off a multi-invoice admission claim | Write off the whole F1-16 claim (e.g. "HMO out of contract") | The write-off splits proportionally across every invoice the stay produced; each invoice's total drops by its own share |
| F1-23 | Census / bed occupancy report | Open Reports with at least one occupied bed | Occupancy panel shows occupied vs. total beds per ward, matching the real-time state of the ward/bed picker |
| F1-24 | Inpatient revenue report | Compare Reports' "Inpatient Revenue" KPI against "Total Revenue" for a period with both outpatient and inpatient activity | Inpatient Revenue shows only admission-billed invoices and is visibly smaller than or equal to Total Revenue, never double-counted or missing |
| F1-25 | Admissions trend | Admit a new patient today, reload Reports | Today's bucket on the admissions trend chart increments by one |

