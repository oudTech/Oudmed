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

## FUNC2: visit reopen, supplementary invoices, note addenda

Pre-dates F1/F2 (phase1-status.md item 4) but was never written up as its
own usability cases - added now since it sits right next to the F1 reopen
flow above and is easy to conflate with it.

| # | Case | Steps | Expected |
|---|---|---|---|
| FUNC2-1 | Reopen a completed visit | Complete a visit, then reopen it as the attending doctor with a reason | Clinical entry unblocks (orders, prescriptions, note edits); a non-attending doctor without admin rights cannot reopen it |
| FUNC2-2 | Late charge after reopen creates a supplementary invoice | After reopening, add a billable order/prescription to a visit whose invoice was already paid or claimed | A new supplementary invoice carries the new charge; the original locked invoice is untouched |
| FUNC2-3 | Reopen flag on billing | Open the billing screen for a reopened visit's invoice | A visible "reopened" flag/banner on the invoice until explicitly acknowledged |
| FUNC2-4 | Note addendum, not an edit | On a completed (or reopened) visit, add an addendum to the clinical note rather than editing it | The original note is unchanged; the addendum appears as a separate, timestamped, authored entry underneath it |

## INV: invoice line edits (billing desk)

phase1-status.md item 9 - the manual invoice line editor and its audit
trail.

| # | Case | Steps | Expected |
|---|---|---|---|
| INV-1 | Add a missed charge | From an unlocked invoice, add a line for a catalogue item | Line added at the catalogue price with no reason required; invoice total updates |
| INV-2 | Price override requires a reason | Add or edit a line at a price different from the catalogue | Blocked until a reason is given; once given, the edit is saved and marked "Edited" |
| INV-3 | Remove a line requires a reason | Remove any existing line from an unlocked invoice | Blocked until a reason is given; invoice total updates once confirmed |
| INV-4 | Locked invoice cannot be edited | Attempt to add/edit/remove a line on an invoice that has a payment or a claim on it | Blocked with a message naming why (has a payment / has a claim); a supplementary invoice can still be edited normally |
| INV-5 | Edit history | Open the edit-history panel on an invoice that has had lines added, overridden and removed | Every edit listed with who, when, before/after values and the reason given |
| INV-6 | Admin review report | As Hospital Admin, open the billing edits report for a date range | Every manual price override and discount across all invoices in that range, reviewable in one place |

## PRINT: printable prescriptions and lab results

phase1-status.md item 10.

| # | Case | Steps | Expected |
|---|---|---|---|
| PRINT-1 | Print a prescription | From a dispensed (or pending) prescription, print it | A4, hospital-branded, patient details, prescriber name, date; one page per prescription |
| PRINT-2 | Print a resulted lab/imaging order | From a resulted lab or imaging order, print it | A4, hospital-branded, patient details, ordering/lab staff name, date, result values; one page per order |
| PRINT-3 | Print before results are in | Attempt to print an order that has not been resulted yet | Either unavailable or clearly marked as pending, never a blank/misleading result printout |

## F2: pay before dispensing

Run against a seeded staging tenant with `requirePaymentBeforeDispense`
toggleable in Settings, at least one drug in the formulary, one
`InsuranceProvider` with a `defaultCoPayPct` between 0 and 100, and both a
PHARMACIST and a HOSPITAL_ADMIN demo login. Confirm the control case first
(F2-1) before turning the setting on, so a failure elsewhere in this
section is never mistaken for the setting having always been this way.

| # | Case | Steps | Expected |
|---|---|---|---|
| F2-1 | Setting off (control) | With the setting off, dispense a cash patient's prescription | Dispensed immediately in one step, exactly as before F2 existed - no Prepare step, no gating |
| F2-2 | Turn the setting on | In Settings > Pharmacy, enable "Require payment before dispensing" | Saves; the dispensing queue's action button changes from "Dispense" to "Prepare" for pending items |
| F2-3 | Prepare a cash charge | With the setting on, Prepare a cash patient's prescription | Charge posted to the patient's invoice; prescription shows "Awaiting payment"; stock levels unchanged |
| F2-4 | Payment gate blocks release | Attempt to release the F2-3 prescription before the invoice is paid | Blocked, reported as still awaiting payment; no stock drawn |
| F2-5 | Payment clears the gate | Pay the F2-3 invoice in full at billing, then return to the pharmacy queue | Item now shows "Paid - ready to dispense"; Release draws stock and hands the item over |
| F2-6 | Partial payment still gates | Pay only part of the F2-3-style invoice's balance | Item stays "Awaiting payment", not released, even though some money has been paid |
| F2-7 | HMO co-pay split | Prepare a prescription for a patient with a co-pay percent between 0 and 100 | The covered share dispenses immediately (stock drawn now); only the co-pay share is gated and shows awaiting payment |
| F2-8 | Fully HMO-covered item | Prepare an item for a patient whose provider has 0% co-pay | Dispensed immediately in full, no gated portion, no "awaiting payment" state at all |
| F2-9 | Inpatient exemption | With the setting on, dispense to a currently admitted patient's prescription | Dispensed immediately regardless of the setting - the gate never applies to an open admission |
| F2-10 | Cancel an unpaid preparation | On an item still awaiting payment, cancel the preparation with a reason | Charge is voided off the invoice; stock was never touched; item returns to its prior (pending) state |
| F2-11 | Emergency override | As Pharmacist or Hospital Admin, dispense directly with "Emergency override" and a reason, bypassing Prepare | Dispensed immediately in the old one-step way; appears in the overrides report with the reason and who did it |
| F2-12 | Emergency override needs a reason | Attempt the emergency override without typing a reason | Blocked until a reason is given |
| F2-13 | Overrides report | As Hospital Admin, open the dispense-overrides report | Every emergency override listed with who, when, items and reason |

