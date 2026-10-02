# OudHealth Usability Test Plan (2026-10-02)

A fresh, complete rewrite of the original 44-case plan
(`docs/audit/usability-test-plan-original.csv`), updated to match how the
app actually works today and expanded to cover everything added since:
inpatient admissions (F1), pay-before-dispense (F2), supplementary
invoices and invoice line edits, the full HMO claims lifecycle including
admission claims, and the platform admin console.

**Structure.** Six connected tester tracks, same convention as the
original: each tester picks up exactly where the previous one left off,
using only the shared data they recorded - nobody should need to ask a
previous tester anything mid-run. A seventh short section
(**Toast & feedback spot-checks**) targets the newest feedback-polish
work specifically. Also exported as `USABILITY_TEST_PLAN.csv` for
Google Sheets.

**Columns.** TC ID, Module, Login Role, Scenario, Steps, Expected Result,
Actual Result, Pass/Fail, Severity (Blocker/Major/Minor/Cosmetic), Notes.
The last four are left blank here - fill them in during the real run.

**Go-live smoke test.** The 19 cases marked `Go-live smoke test` in the
Notes column are the minimum set to check the hospital's first day is
safe - run these alone if there's no time for the full plan.

## Setup & Shared Data

Keep one shared sheet (or doc) all testers read/write as they go. Fields
every tester will need, recorded by whoever creates them:

- Hospital name, subdomain, admin email/password (T1-02)
- Staff logins: Reception, Nurse, Doctor, Lab Staff, Pharmacist, Accountant
  (T1-05)
- Patient A (cash): name, patient number (T1-08)
- Patient B (HMO): name, patient number, insurer (T1-10)
- Patient A's and B's appointment date/time (T1-11, T1-12)
- Invoice A (cash) and Invoice B (HMO) numbers (T2-07, T2-11)
- Admission A (cash) and Admission B (HMO, with its PA code) numbers
  (T4-01, T4-07)
- Platform admin login URL and credentials (pre-existing - not created by
  testers)

---

## Tester 1 - Reception / hospital setup

| TC ID | Module | Login Role | Scenario | Steps | Expected Result | Notes |
|---|---|---|---|---|---|---|
| T1-01 | Marketing Homepage | None (logged out) | First impression & pricing comprehension | 1. Visit the Oudmed homepage. 2. Scroll the "Practice Experience" wheel; click 3+ segments. 3. Scroll to the pricing calculator; drag the user-count slider to 8 users. 4. Toggle Monthly/Annually. | Homepage loads with no layout/overflow issues; wheel segments respond and show correct content; pricing recalculates correctly for both billing cycles. | |
| T1-02 | Sign Up | None | Create a new hospital account | 1. Click "Get Started". 2. Fill in hospital name, admin name, email, password. 3. Submit. 4. Record hospital name, subdomain, admin credentials in Setup & Shared Data. | Form validates required fields; on success, user is told to check their email for a verification code. | Go-live smoke test |
| T1-03 | Email Verification | None | Verify the new account | 1. Open the verification email. 2. Enter the 6-digit code shown in it on the verification screen. | Code is accepted; user is redirected to login (or auto-logged in) with a clear success message. **(Verification is a 6-digit code by design, not a link - updated from the original plan's assumption.)** | Go-live smoke test |
| T1-04 | Dashboard | Hospital Admin (new) | First-run experience | 1. Log in at the hospital's subdomain. 2. Observe the dashboard. | Role-aware dashboard loads; a first-run checklist / onboarding tour is visible and can be followed or dismissed. | |
| T1-05 | HR | Hospital Admin | Provision every staff role needed for the run | 1. HR > Add User. 2. Leave a required field blank and submit once, to confirm the Add User button is always clickable with per-field errors shown (not disabled with no explanation). 3. Create one user per role: Reception, Nurse, Doctor, Lab Staff, Pharmacist, Accountant - setting each initial password directly. 4. Record every email/password as you go. | Step 2 shows clear per-field errors, not a dead button. **(Add User button is always clickable with per-field errors by design.)** All 6 users are created, each appears in the staff directory with the correct role and Active status. | |
| T1-06 | Login / Access Control | Reception | Verify role-based access | 1. Log out, log back in as Reception. 2. Confirm only appropriate nav/actions are visible. 3. Attempt to navigate directly to `/admin` and `/reports` by typing the URL. | Reception sees no HR/Admin/Settings/Reports in the nav; direct URL navigation to those routes is also blocked, not just hidden. | Go-live smoke test |
| T1-07 | Patients > New (steps 1-2) | Reception | Start registering Patient A (cash) | 1. Patients > New. 2. Complete step 1 (basic info) and step 2 (contact info). | Patient record is created after step 2 with a patient number (e.g. `PT-00001`); the wizard is resumable later. **(Current registration wizard behaviour.)** | |
| T1-08 | Patients > New (steps 3-8) | Reception | Complete Patient A's registration | 1. Resume the wizard from the Patients list. 2. Complete the remaining steps (address, next of kin, payer = Cash, ID document, photo, consent, review). 3. Submit. 4. Record Patient A's name and number. | All steps save; on finishing, a toast confirms "Patient PT-0000X registered"; patient appears in the Patients list. | Go-live smoke test |
| T1-09 | Patient Chart | Reception | Verify Patient A's record | 1. Search for Patient A. 2. Open their chart. | All information entered during registration is correctly reflected across the chart's tabs. | |
| T1-10 | Patients > New | Reception | Register Patient B (HMO) | 1. Patients > New, complete all 8 steps for a second patient. 2. At the payer step, select payer type HMO and choose a real insurance provider via the autocomplete (don't free-type it). 3. Record Patient B's name, number, and insurer. | Provider autocomplete returns real configured insurers; registration completes; Patient B appears with payer type HMO. | |
| T1-11 | Schedule | Reception | Book Patient A's appointment | 1. Schedule > New appointment, Patient A with the Doctor from T1-05, today. 2. Save. 3. Record the date/time. | Appointment appears on the calendar as "Scheduled" with the correct patient/doctor; a toast confirms the booking. | |
| T1-12 | Schedule | Reception | Book Patient B's appointment | 1. Same as T1-11, for Patient B. | Same as T1-11. | |
| T1-13 | Handoff | Reception | Confirm ready to hand off | 1. Double-check Setup & Shared Data is filled in for every field Tester 1 owns. | Tester 2 can find both patients and appointments from the shared sheet alone, without asking Tester 1 anything. | |

## Tester 2 - Nurse + Doctor + Lab (outpatient clinical, both patients)

| TC ID | Module | Login Role | Scenario | Steps | Expected Result | Notes |
|---|---|---|---|---|---|---|
| T2-01 | Login / Schedule | Nurse | Access the nursing workflow | 1. Log in with the Nurse credentials. 2. Find Patient A's appointment on Schedule. | Nurse can see the appointment and open the visit from it. | |
| T2-02 | Visit / Vitals | Nurse | Check Patient A in, record vitals | 1. Open the visit, set status to checked-in / in progress. 2. Record vitals (BP, temperature, pulse, weight). | Visit status updates correctly; vitals save and are visible on the encounter workspace. | Go-live smoke test |
| T2-03 | Encounter Workspace | Doctor | Access the same visit | 1. Log out, log in as Doctor. 2. Open Patient A's encounter workspace. | Doctor sees the complaint/vitals the nurse already entered - nothing lost switching roles. | |
| T2-04 | Clinical Note | Doctor | Document the consultation | 1. Record the chief complaint. 2. Write a SOAP note. | Both save correctly, timestamped and attributed to the doctor. | |
| T2-05 | Diagnosis | Doctor | Add a diagnosis | 1. Add a diagnosis to Patient A's visit. | Diagnosis saves and appears on both the visit summary and the patient chart. | |
| T2-06 | e-Prescription | Doctor | Prescribe, including an off-formulary item | 1. Add a prescription item via the drug autocomplete (pulls from the Pharmacy catalogue). 2. Add a second item by typing a drug name not in the catalogue. 3. Save. | Autocomplete returns real catalogue drugs; the off-catalogue name triggers a "did you mean..." / off-formulary confirmation before it can save as free-text - not a silent save. **(Off-formulary prompt when the drug isn't in the catalogue.)** Both items attach to the visit. | |
| T2-07 | Lab Order & Visit Completion | Doctor | Order a lab test, close the consultation | 1. Add a clinical order for a lab test. 2. Mark the visit complete. 3. Record the resulting invoice number as "Invoice A (cash)". | Order created as Pending; completing the visit posts a charge to a new invoice automatically; a toast confirms completion. | Go-live smoke test |
| T2-08 | Lab Worklist | Lab Staff | Access Patient A's pending order | 1. Log in as Lab Staff. 2. Open the worklist, find the order from T2-07. | Order appears with the correct patient and test. | |
| T2-09 | Lab Result | Lab Staff | Complete Patient A's lab order | 1. Open the order, enter a result value. 2. Mark it complete. | Result saves; order status updates to Resulted; a toast confirms; the result is visible back on the patient's chart. | |
| T2-10 | Visit / Vitals | Nurse | Check Patient B in, record vitals | 1. Log back in as Nurse. 2. Check Patient B in, record vitals. | Same as T2-01/T2-02, for Patient B. | |
| T2-11 | Encounter Workspace | Doctor | Full consultation for Patient B | 1. Open Patient B's visit. 2. Complaint + SOAP note. 3. Diagnosis. 4. Prescribe a catalogue drug. 5. Order a lab test. 6. Complete the visit. 7. Record the resulting invoice number as "Invoice B (HMO)". | Each step saves correctly; completing the visit posts a charge to a new invoice with payer type HMO (inherited from registration). | |
| T2-12 | Lab Worklist / Result | Lab Staff | Result Patient B's order | 1. Find and result Patient B's order. | Same as T2-08/T2-09. | |

## Tester 3 - Pharmacist + Accountant (dispensing incl. pay-before-dispense, billing, claims)

| TC ID | Module | Login Role | Scenario | Steps | Expected Result | Notes |
|---|---|---|---|---|---|---|
| T3-01 | Pharmacy > Dispensing | Pharmacist | Access the dispensing queue | 1. Log in as Pharmacist. 2. Open Pharmacy > Dispensing. | Both patients' prescriptions appear in the queue. | |
| T3-02 | Dispensing | Pharmacist | Dispense Patient A's prescription (gate off - control case) | 1. Select the prescription. 2. Dispense the prescribed quantity. | Stock decrements earliest-expiry-first (FEFO); a toast confirms "Dispensed to Patient A's name"; insufficient stock shows a clear message, never a silent short-dispense. | Go-live smoke test |
| T3-03 | Pharmacy > Inventory | Pharmacist | Verify inventory accuracy | 1. Open Inventory, find the dispensed drug. | Quantity-on-hand reflects the dispensed amount; per-batch stock is accurate. | |
| T3-04 | Pharmacy > Inventory | Pharmacist | Add new stock | 1. Add a new drug batch manually, or import via CSV. | New batch appears with correct expiry/quantity; the usage chart updates; a clear error shows if the CSV import request itself fails. | |
| T3-05 | Settings > Pharmacy | Hospital Admin | Turn on the payment gate | 1. Log in as Hospital Admin (or hand off briefly). 2. Settings > Pharmacy > enable "Require payment before dispensing". 3. Save. | Setting saves; the dispensing queue's action button changes from "Dispense" to "Prepare" for pending items. | |
| T3-06 | Dispensing | Pharmacist | Prepare Patient B's prescription | 1. Log back in as Pharmacist. 2. Open Patient B's prescription, click Prepare, confirm quantities. | Charge posts to Patient B's invoice; prescription shows "Awaiting payment"; stock levels are unchanged. | Go-live smoke test |
| T3-07 | Dispensing | Pharmacist | Attempt release before payment | 1. Open the Review screen for the same prescription. 2. Click "Release ready items". | Blocked, reported as still awaiting payment; no stock is drawn. | Go-live smoke test |
| T3-08 | Billing > Invoices | Accountant | Access and verify both invoices | 1. Log in as Accountant. 2. Open Billing > Invoices, open Invoice A and Invoice B, review line items. | Both invoices appear; line items match the consultation plus dispensed/prepared drug(s), correct amounts and payer type. | |
| T3-09 | Billing > Line edit | Accountant | Add a missed charge, then remove it with a reason | 1. On Invoice A, add a line for a catalogue service item (no reason needed). 2. Remove that same line (reason required). | Line adds without friction; removal is blocked until a reason is typed; both actions appear in the invoice's edit history with who/when/before-after. | |
| T3-10 | Billing > Record Payment | Accountant | Pay Invoice A (cash) in full | 1. Record Payment, enter payer/method/amount, submit. | Payment recorded; invoice status updates to Paid; a printable receipt generates. | Go-live smoke test |
| T3-11 | Billing > Supplementary invoice | Accountant | Trigger a supplementary invoice on Patient B | 1. Record a partial payment against Invoice B - just enough to lock it. 2. Add one more billable charge to Patient B's visit (e.g. another lab order via Tester 2's login), completed again. | The new charge lands on a brand-new supplementary invoice for the same visit, not the now-locked Invoice B; the billing screen clearly marks it supplementary. | |
| T3-12 | Dispensing | Pharmacist | Release Patient B's prescription after payment | 1. Back in Pharmacy > Dispensing, open Patient B's Review screen. 2. Click "Release ready items" again. | Now shows "Paid - ready to dispense"; releasing draws stock and completes the dispense. | Go-live smoke test |
| T3-13 | Dispensing | Pharmacist | Cancel an unpaid preparation | 1. Prepare one more item on any pending prescription. 2. On the Review screen, Cancel it with a reason. | Charge is voided off the invoice; the item returns to pending; no stock was ever drawn. | |
| T3-14 | Dispensing | Pharmacist | Emergency override | 1. Prepare an item, but before paying, instead dispense a different item directly with "Emergency override" and a reason. | Dispensed immediately, bypassing the gate; later appears in the admin's dispense-overrides report (T5-06) with the reason and who did it. | |
| T3-15 | Claims | Accountant | Generate an HMO claim from Invoice B | 1. Go to Claims, generate a claim from Invoice B. | Claim created with the correct patient, invoice, and payer linkage, co-pay split applied. | Go-live smoke test |
| T3-16 | Claims | Accountant | Submit, batch, export | 1. Submit the claim. 2. Add it to a batch for the provider. 3. Export the batch schedule as CSV. | Claim status progresses correctly; export shows a loading-then-success confirmation; the CSV contains the expected claim data. | |
| T3-17 | Claims > Remittance | Accountant | Close the financial loop | 1. Record a remittance against the batch (approved/paid amount). 2. Open the receivables aging report. | Remittance allocates correctly to the claim/invoice; aging accurately reflects the hospital's outstanding balance. | Go-live smoke test |
| T3-18 | Claims > Write-off | Accountant | Write off a shortfall | 1. If T3-17 left a shortfall on the claim, write it off with a reason. | A negative "HMO Adjustment" line posts to the invoice; the claim closes as Written off; aging returns to baseline. | |

## Tester 4 - Inpatient (admit through discharge, cash and HMO)

| TC ID | Module | Login Role | Scenario | Steps | Expected Result | Notes |
|---|---|---|---|---|---|---|
| T4-01 | Admissions | Nurse | Admit Patient A (cash) | 1. From Patient A's chart or the ward board, start Admit. 2. Pick an active ward and available bed. 3. Set admission type. | Admission created, status Admitted; the bed shows Occupied; a toast confirms who was admitted where. | Go-live smoke test |
| T4-02 | Admissions > Deposit | Reception | Take a deposit for Patient A | 1. On the admission, Add deposit (cash), larger than the expected stay cost. | Receipt shown/printable; deposit appears on the admission and the payment ledger tagged "Deposit", not counted in Total Collection. | |
| T4-03 | Admissions > Workspace | Nurse / Doctor | Add a charge during the stay | 1. From the admission workspace, add a service charge (e.g. a lab order). | Charge lands on the admission's own invoice, not a visit's; appears on the interim bill. | |
| T4-04 | Admissions > Interim bill | Reception / Accountant | Check the running bill mid-stay | 1. Open "Interim bill" from the admission. | Printable A4, labelled "Interim bill - stay in progress"; running totals match what's been entered. | |
| T4-05 | Admissions > Discharge | Nurse | Discharge Patient A, balance clears clean | 1. Discharge Patient A; let the deposit auto-apply. | Status becomes Discharged; final bill totals match; any deposit remainder either refunds immediately or shows pending - discharge completes either way, never blocked. | Go-live smoke test |
| T4-06 | Billing > Refunds due | Accountant | Pay out Patient A's pending refund, if any | 1. If T4-05 left a pending refund, open Refunds due and pay it out. | Refund receipt issued; a cash-ledger entry appears tagged "Deposit refund"; it no longer shows as pending. | |
| T4-07 | Admissions | Nurse | Admit Patient B (HMO) with a pre-authorization code | 1. Admit Patient B to a ward/bed. 2. Enter a pre-authorization code (e.g. `AUTH-2026-001`). | Admission created with the PA code recorded. | |
| T4-08 | Admissions > Deposit | Reception | Take a deposit for Patient B | 1. Add a deposit smaller than the full expected bill but larger than the expected patient co-pay share. | Receipt issued as before. | |
| T4-09 | Admissions > Workspace | Doctor | Add charges during Patient B's stay | 1. Add at least one service charge and one pharmacy charge. | Both charges land on the admission's invoice. | |
| T4-10 | Admissions > Discharge | Nurse | Discharge Patient B - deposit applies to the patient's share only | 1. Discharge Patient B. | Only the patient-payable (co-pay) portion of the bill is drawn from the deposit - never the HMO-expected portion; any remainder beyond the patient's share refunds or shows pending, same as T4-05. | Go-live smoke test |
| T4-11 | Claims | Accountant | Generate Patient B's admission claim | 1. Claims > generate a claim for Patient B's admission (needs the PA code from T4-07). | One claim created spanning every invoice the stay produced; claimed/patient-responsibility amounts match the co-pay split. | Go-live smoke test |
| T4-12 | Claims | Accountant | Confirm PA-code enforcement | 1. Admit a quick third test patient with no PA code, discharge it, attempt to generate its claim. | Blocked with a clear message that a pre-authorization code is required. | |
| T4-13 | Claims | Hospital Admin | Confirm the PA override | 1. Retry T4-12's claim generation, this time entering an override reason (Hospital Admin only). | Claim generates; flagged "No PA code" on the claim detail (and would be on a batch export). | |
| T4-14 | Claims > Remittance | Accountant | Remit Patient B's admission claim across multiple invoices | 1. Submit the claim from T4-11. 2. Record a remittance paying it in full. | Payment splits correctly across every invoice the claim covers, not just the first one. | |
| T4-15 | Reports | Accountant / Hospital Admin | Confirm occupancy and inpatient revenue | 1. Open Reports, check the bed occupancy panel and the Inpatient Revenue KPI. | Occupancy reflects the real-time ward/bed state; Inpatient Revenue shows only admission-billed invoices, visibly ≤ Total Revenue. | |

## Tester 5 - Hospital Admin (settings, admin, HR, reports)

| TC ID | Module | Login Role | Scenario | Steps | Expected Result | Notes |
|---|---|---|---|---|---|---|
| T5-01 | Settings | Hospital Admin | Access admin settings | 1. Open Settings. | Loads with hospital profile, branding, and invoice/receipt prefix options. | |
| T5-02 | Settings > Branding | Hospital Admin | Update hospital branding | 1. Upload a logo. 2. Change the accent color. 3. Save. | Logo and color persist and are reflected across the app (header/navigation). | |
| T5-03 | Administration | Hospital Admin | Manage departments & services | 1. Add a new Department and a new Service Item with a code. | Both appear and are usable elsewhere (selectable in scheduling/billing). | |
| T5-04 | Administration > Insurance | Hospital Admin | Manage the payer list | 1. Add a new Insurance Provider. | Appears and is selectable in patient registration and claims flows. | |
| T5-05 | HR | Hospital Admin | Staff deactivation safety | 1. Attempt to deactivate the only remaining active Hospital Admin (or the currently logged-in user). | Blocked with a clear message (cannot deactivate self / last admin). | |
| T5-06 | Pharmacy > Overrides report | Hospital Admin | Review the emergency override from T3-14 | 1. Open the dispense-overrides report. | The T3-14 override is listed with who, when, items and reason. | |
| T5-07 | Reports | Hospital Admin | Verify reporting reflects real activity | 1. Check the financial KPIs, patient trend, bed occupancy, and payment ledger against everything Testers 1-4 did. | Reports accurately reflect the patients registered, visits billed, admissions, and payments recorded earlier in the run. | |
| T5-08 | Reports > Export | Hospital Admin | Export data with a custom date range | 1. Set a custom from/to range (not just a preset) on the payment ledger. 2. Export to CSV. | **(Custom date range now exists.)** Custom range is respected; export shows a loading-then-success confirmation; CSV contains the filtered, correct data. | |
| T5-09 | Login (suspended check prep) | Hospital Admin | Note current state before Tester 6 suspends the hospital | 1. Confirm you can currently log in normally. | Baseline for T6-04's enforcement check. | |

## Tester 6 - Platform admin

| TC ID | Module | Login Role | Scenario | Steps | Expected Result | Notes |
|---|---|---|---|---|---|---|
| T6-01 | Platform Login | Platform Admin | Access the platform console | 1. Log out of the hospital workspace entirely. 2. Go to the platform login URL and log in with a Platform Admin account. | Platform console loads, completely separate from any hospital's own workspace. **(Platform admin is its own cross-tenant login, separate from any hospital's SUPER_ADMIN role - confirm the two are not conflated.)** | Go-live smoke test |
| T6-02 | Platform Overview | Platform Admin | Review platform-wide metrics | 1. Open the Overview screen. | Total hospital count, MRR, and revenue trend reflect the test hospital created in T1-02. | |
| T6-03 | All Hospitals | Platform Admin | Inspect the test hospital | 1. Open All Hospitals, find and open the test hospital. | Subscription status, seat count, and invoice history shown correctly. | |
| T6-04 | All Hospitals > Suspend | Platform Admin | Test enforcement | 1. Suspend the test hospital. 2. In a separate/incognito session, attempt to log in as any of its staff. | Staff login is blocked; they see a distinct "Account suspended - Contact support" screen, not a generic error. **(Suspended-hospital screen updated per decision.)** | Go-live smoke test |
| T6-05 | All Hospitals > Reactivate | Platform Admin | Undo suspension | 1. Reactivate the hospital. | Staff can log in normally again. | |
| T6-06 | Platform Settings > Maintenance | Platform Admin | Test the platform-wide kill switch | 1. Toggle Maintenance Mode on; check a hospital session. 2. Toggle it back off. | While on, hospital users see a maintenance notice instead of the app; platform routes stay reachable; toggling off restores normal access immediately. | |
| T6-07 | Platform Activity | Platform Admin | Verify traceability | 1. Open the Platform Activity feed. | The suspend/reactivate actions (and any other platform actions taken) are logged with operator name and timestamp. | |

## Toast & feedback spot-checks

Targeted checks on the newest feedback-polish work (2026-10-02) - these are
the least human-tested paths in the app, since they were just fixed.

| TC ID | Module | Login Role | Scenario | Steps | Expected Result | Notes |
|---|---|---|---|---|---|---|
| F-01 | Pharmacy > Inventory | Pharmacist | Delete an inventory item | 1. Delete a drug with no stock history. 2. Attempt to delete one that does have history. | First shows a success toast; second is archived instead with a clear message, never silent. | |
| F-02 | Pharmacy > Inventory | Pharmacist | CSV import failure | 1. Attempt to import an invalid/corrupted CSV file. | A clear error toast appears if the request itself fails - not just per-row errors inside a successful response. | |
| F-03 | Encounters | Doctor | Cancel an investigation order | 1. Cancel a pending order. | A toast confirms cancellation. | |
| F-04 | Claims | Accountant | Export a batch schedule CSV | 1. Export any batch's schedule. | A loading toast appears ("Exporting..."), then a success toast - not just a bare button spinner with no feedback either way. | |
| F-05 | Patients > New | Reception | Duplicate check failure | 1. If possible, force the dedupe check to fail (e.g. a network interruption). | The step shows its own error message, never falls through to "No existing record found." | |
| F-06 | Patient Chart | Reception / Nurse | Patient photo upload | 1. Upload a valid photo - confirm a success toast. 2. Attempt an invalid file type - confirm a clear error toast. | Both outcomes give explicit feedback, neither closes silently. | |
| F-07 | Platform > Hospitals | Platform Admin | Invalid-state action | 1. Attempt to suspend an already-suspended hospital (or reactivate an already-active one). | A clear error toast explains why, rather than nothing happening. | |
| F-08 | Administration | Hospital Admin | Toggle a department/service active | 1. Deactivate, then reactivate, a department or service. | Each action shows its own specific success toast naming what changed (e.g. "Radiology deactivated"), not just a silent list refresh. | |
