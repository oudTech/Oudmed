# F1: Inpatient / Admissions Billing

Status: approved, building in sub-steps F1a → F1b → F1c → F1d (see
`docs/audit/phase1-status.md`). Scope-change item (2026-10-01) - promoted
from backlog to a Phase 1 launch blocker. See `docs/audit/pricing-notes.md`
for the original gap analysis this design is built on.

## 1. What exists today

Confirmed directly against the schema and services, not recalled from memory:

- **`Ward`** (`schema.prisma:815-829`) - name, `WardType` enum (GENERAL,
  PRIVATE, ICU, HDU, MATERNITY, PEDIATRIC, ISOLATION), active flag. **No rate
  field.**
- **`Bed`** (`schema.prisma:831-845`) - belongs to a ward, a label, a
  `BedStatus` (AVAILABLE, OCCUPIED, RESERVED, MAINTENANCE).
- **`Admission`** (`schema.prisma:1300-1339`) - patient, admitting/attending
  doctor, department, ward, bed, `AdmissionType` (EMERGENCY, ELECTIVE,
  TRANSFER, REFERRAL, OBSERVATION), `AdmissionStatus` (ADMITTED, DISCHARGED,
  TRANSFERRED_OUT, DECEASED, ABSCONDED), reason, provisional diagnosis,
  **`payerType`/`hmoName`/`authCode` already present** (just never used by
  anything billing-related), admitted/expected-discharge/discharged
  timestamps, discharge notes. **No link to a Visit, no rate, no charge of
  any kind.**
- **`AdmissionsService`** (`apps/api/src/admissions/admissions.service.ts`) -
  `admit`, `transfer`, `discharge`, `update`, `list`, `getOne`. Confirmed by
  reading every line: none of them call `postChargeToVisit`, create an
  `Invoice`/`InvoiceLine`, or reference a price. Transfer only moves
  `wardId`/`bedId` and flips `Bed.status`; it keeps no history of which ward
  a patient was in at any past moment. Discharge only frees the bed and
  stamps `dischargedAt`/`dischargeNotes`.
- **Permissions already exist**: `admission:create`/`edit`/`transfer`/
  `discharge` (`permissions.ts:63-66`) - NURSE/DOCTOR/HOSPITAL_ADMIN in
  various combinations, transfer is NURSE/HOSPITAL_ADMIN only.
- **Clinical models link to a Visit, not an Admission** - confirmed by
  grep: `Complaint`, `Diagnosis`, `Prescription`, `ClinicalNote`,
  `ClinicalOrder` all have `visitId String?` and **no `admissionId`**.
  `VitalSigns` is the one exception - it already has both `visitId` and
  `admissionId`. This matters below (section 3).
- **FUNC-2's visit-reopen mechanism**, confirmed by reading
  `encounters.service.ts`/`schedule.service.ts`: `visit:reopen` (attending
  doctor or admin, reason, audited), `Visit.reopenedAt`, a completed-visit
  guard that blocks new orders/prescriptions/note-edits while leaving
  complaint/vitals/diagnosis append-only with a computed `lateEntry` flag,
  `ClinicalNoteAddendum` for late note additions (references the note
  itself, not the visit), and `flagReopenedInvoices`/`acknowledgeReopen` for
  billing staff visibility when a reopened visit's invoice was already
  locked. Section 4 below defines the admission-equivalent of every one of
  these.
- **Billing's charge-posting machinery is visit-shaped**:
  `BillingService.postChargeToVisit` / `resolveOpenInvoiceForVisit`
  (`billing.service.ts:118-197`) resolve which invoice a new charge lands on
  for a given `visitId` - the primary invoice if open, an existing open
  supplementary invoice if the primary is locked (paid or claimed), or a new
  supplementary invoice otherwise (FUNC-2). This is the exact mechanism the
  brief asks to reuse for admissions.
- **Claims are per-invoice**: `InsuranceClaim.invoiceId` is a `@unique`
  nullable FK (`schema.prisma:668`); `InsuranceClaimLine.invoiceLineId`
  (`schema.prisma:712`) is a bare, unconstrained string - it is **not** a
  real foreign key, so a claim line is not actually required to belong to
  the claim's own `invoiceId`. This turns out to matter for section 7.
- **`InsuranceClaimLine` is only ever created in one place**, confirmed by
  grep across the whole codebase: `claims.service.ts:556`'s
  `createMany`, fed from `invoice.lines.map(l => ({ invoiceLineId: l.id,
  ... }))` (`:419-426`). No other code path creates a claim line. This
  matters for section 7's backfill question.
- **No cron infrastructure needed from scratch** - `@nestjs/schedule` is
  already a dependency and already used
  (`apps/api/src/subscriptions/renewal.service.ts`, three daily `@Cron`
  jobs iterating every active tenant via `PrismaService.forTenant`). The
  bed-day charge job below follows that exact pattern.
- **The existing payment ledger / daily cash reports** (`ReportsService.payments`/
  `paymentsCsv`) are entirely `Payment`-table driven today - this matters
  for section 5's cash-reconciliation requirement.
- **Reports have no inpatient numbers at all** - `ReportsService.overview()`
  is entirely visit/invoice based; no census or bed-occupancy query exists.
- **Lagos time helpers exist** (`common/lagos-time.ts`, built this session)
  - `startOfDayLagos`, `lagosCalendarDate`, etc. - this is what the
    midnight-census day-counting logic below is built on; no new timezone
    dependency is needed.

**Conclusion**: this genuinely is a from-scratch feature, not a wiring bug.
Every piece below is new except the admission/ward/bed CRUD and the
charge-posting primitives it reuses.

## 2. Admission episode and the running bill

**Decision: do not invent a parallel ledger.** An admission's "running bill"
is just `Invoice`/`InvoiceLine` rows scoped to that admission, using the
exact same supplementary-invoice-on-lock mechanism visits already have
(FUNC-2). This means every existing billing read (balance, payment, receipt,
cancel, line-edit-with-audit from the item 9 work) works on an admission's
invoices with no new code.

### Schema changes

```prisma
model Admission {
  // ...existing fields...
  originatingVisitId String?
  originatingVisit    Visit?  @relation("AdmissionOriginVisit", fields: [originatingVisitId], references: [id])
  reopenedAt          DateTime?
}

model Invoice {
  // ...existing fields...
  admissionId String?
  admission   Admission? @relation(fields: [admissionId], references: [id])
  @@index([admissionId])
}
```

- `admissionId` is nullable and sits alongside the existing `visitId` -
  an invoice is either visit-scoped or admission-scoped, never both (the
  running bill is not "a visit's invoice," it is the admission's own).
- `originatingVisitId` is purely for traceability ("this admission started
  from today's 2pm outpatient visit") - it does not affect billing.
- `reopenedAt` mirrors `Visit.reopenedAt`, used by section 4's reopen flow.

### Service changes

- New `BillingService.resolveOpenInvoiceForAdmission(tx, { admissionId, tenantId, patientId, category })`,
  a straight copy of `resolveOpenInvoiceForVisit`'s logic (find the primary
  non-supplementary invoice for this `admissionId`; if locked, find or
  create an open supplementary one) - same code shape, different lookup key.
- `ChargeInput` gains an optional `admissionId?: string` alongside
  `visitId`. `postChargeToVisit` is renamed in spirit to a dispatcher
  `postCharge(tx, input)`: if `admissionId` is set, resolve via the
  admission path; otherwise the existing visit path, unchanged. Every
  existing caller (`pharmacy.service.ts`, `encounters.service.ts`) keeps
  calling with a `visitId` and is unaffected.
- **A charge's billing target comes from where it was created, not from the
  patient's live admission status** (corrected after review - the first pass
  got this backwards). A prescription or order already carries its own
  source: `admissionId` if written from the inpatient workspace, `visitId` if
  written from the outpatient encounter workspace. That recorded source wins
  outright. `resolveBillingTarget(tx, patientId)` - find the patient's open
  `ADMITTED` admission, or `null` - is only consulted when a prescription has
  **neither** recorded (written from the general patient chart, with no
  encounter context at all), so it does not land on a stray standalone
  invoice. Concretely: `pharmacy.dispense()` checks `rx.admissionId`, then
  `rx.visitId`, and only calls `resolveBillingTarget` if both are empty;
  `encounters.createOrder()` is only ever reached from the outpatient
  workspace, so it always charges its own `visitId` and never calls
  `resolveBillingTarget` at all - an order raised there stays on that visit's
  invoice even if the patient is admitted moments later. The inpatient
  workspace's own order/note creation (F1b) will charge the admission
  directly, the same way its prescriptions already do, by passing
  `admissionId` as its own recorded source - not through this fallback.
- **The admission's originating visit is not special-cased.** A charge
  created against `originatingVisitId` after the admission has started still
  follows the rule above and stays on that visit's own invoice - the same as
  any other visit-sourced charge. Carving out an exception here (merging the
  originating visit's later charges into the admission bill) was considered
  and rejected: it would require checking `admission.originatingVisitId ==
  visit.id` at every charge site, a second, harder-to-audit fallback path
  alongside the general rule, for a scenario normal staff workflow design
  already avoids - once admitted, a clinician records new activity against
  the admission workspace, not the now-superseded originating visit.
- `flagReopenedInvoices`/`acknowledgeReopen` (FUNC-2, `billing.service.ts`)
  are generalised to accept either a `visitId` or an `admissionId` lookup -
  same two methods, one more `where` clause each, so a reopened admission's
  locked invoices get the identical billing-desk flag/acknowledge flow a
  reopened visit already has.

## 3. Schema gap: clinical models need `admissionId` too

`VitalSigns` already supports being recorded against an admission.
`Complaint`, `Diagnosis`, `Prescription`, `ClinicalNote`, `ClinicalOrder` do
not - they can only be tied to a Visit. For an inpatient stay, ward-round
notes, in-stay diagnoses, in-stay prescriptions and in-stay lab/imaging
orders all need to be attributable to the *admission*, both so the charge
can route there and so the discharge summary (section 8) can assemble what
happened during the stay.

**Migration**: add `admissionId String?` (+ `@relation`, + index) to
`Complaint`, `Diagnosis`, `Prescription`, `ClinicalNote`, `ClinicalOrder`,
mirroring `VitalSigns`'s existing shape exactly. Nullable, additive, no data
migration needed (existing rows stay visit-only). The new inpatient
workspace (section 4) passes `admissionId` instead of `visitId` when
recording against an admission.

**Why not route through the admission's visit(s) instead** (the smaller
migration, considered and rejected): confirmed by reading
`encounters.service.ts` and `patients/clinical.service.ts` directly -
`Complaint`/`Diagnosis`/`Prescription`/`ClinicalNote`/`ClinicalOrder` are
queried two different ways today, and neither suits reuse as-is:

- The **patient chart's tabs** (`clinical.service.ts:47-51` and siblings)
  list these by **`patientId`**, not `visitId` - a patient's whole
  diagnosis/prescription history across every encounter, ever. This path is
  completely unaffected by whichever linking choice F1 makes; it is why the
  migration is safe regardless (see below).
- The **encounter workspace** (`encounters.service.ts:67-71`,
  `/encounters/[visitId]`) lists these by **`visitId`** - and that page's
  whole model is a single-sitting outpatient encounter: one `doctorId`,
  a scheduling/check-in lifecycle (`VisitStatus`), and FUNC-2's
  completed-visit guard that blocks new orders/prescriptions once the visit
  is `COMPLETED`.

Routing an admission through "one synthetic Visit per stay" would need that
Visit to stay open for days or weeks, under a model built around a same-day
appointment, and would conflate two genuinely different real-world shapes:
an admission already has separate `admittingDoctor`/`attendingDoctor`
fields precisely because more than one clinician is involved over a stay,
which a single `Visit.doctorId` does not represent; and the encounter
workspace's UI would need admission-specific behaviour anyway (a multi-day
timeline is not what that page is designed to show) - so the "smaller
migration" does not actually avoid new work, it just moves the same problem
into the Visit/Encounters model, which then needs its own changes to cope.
`admissionId` on five tables, by contrast, is **purely additive**: every
existing query above keeps working exactly as it does today (patient-chart
tabs stay `patientId`-keyed, the encounter workspace stays `visitId`-keyed),
and it mirrors the one precedent this schema already has (`VitalSigns`)
instead of introducing a second, different pattern. Recommendation stands:
add `admissionId` to the five models.

## 4. Inpatient clinical workspace

**New screen**: `/admissions/[admissionId]`, the admission-scoped sibling of
`/encounters/[visitId]`. Header shows patient, ward/bed, admitting/attending
doctor, days so far, and the running-bill summary (balance, deposit held -
section 5) with a link to the full interim bill (section 9). Below it,
exactly the same recording surfaces the encounter workspace already has -
vitals, SOAP notes, orders, prescriptions, diagnoses, complaints - reusing
the existing `AddVitalsModal`/`AddDiagnosisModal`/`AddPrescriptionModal`/
note editor/order-creation components with an `admissionId` prop alongside
their existing `visitId` prop, so one component serves both contexts rather
than forking it. Each modal passes whichever id it was given straight
through to the already-existing `clinical.service.ts` endpoints, which
(section 3) now accept either.

### Item 4 (FUNC-2) equivalents for an admission

| FUNC-2 concept (visit) | Admission equivalent |
|---|---|
| Completed-visit guard blocks new orders/prescriptions/note edits | Same guard, keyed on `AdmissionStatus !== 'ADMITTED'` (i.e. `DISCHARGED`/`DECEASED`/`ABSCONDED`/`TRANSFERRED_OUT`) instead of `VisitStatus === 'COMPLETED'` |
| Complaint/vitals/diagnosis stay append-only post-completion, with a computed `lateEntry` flag | Same mechanism; `lateEntry` compares `recordedAt`/`diagnosedAt` to `admission.dischargedAt` instead of `visit.completedAt` |
| `ClinicalNoteAddendum` for a late note addition | **No change needed** - it references the note itself, not a visit or admission, so an admission-linked note already gets addenda for free |
| `visit:reopen` (attending doctor or admin, reason, audited) | New `admission:reopen` (attending doctor or HOSPITAL_ADMIN, reason, audited `ADMISSION_REOPENED`), sets `Admission.reopenedAt` |
| `flagReopenedInvoices`/`acknowledgeReopen` for a reopened visit's locked invoice | Same two methods, generalised (section 2) to also accept an `admissionId` |

**Deliberate difference from visit-reopen**: reopening an admission does
**not** change `AdmissionStatus` back to `ADMITTED` and does not reopen a
ward stay or free/re-occupy a bed - the patient is not physically back in
the hospital. It only lifts the completed-admission guard on new clinical
entries for a bounded correction (a late lab result, a note that needs
amending), exactly the same narrow purpose `visit:reopen` already serves
for an outpatient encounter. A late charge created this way finds the
admission's invoices already locked (settled at discharge, section 8) and
opens a new supplementary invoice automatically - the same FUNC-2 mechanism
as a reopened visit, not a new one.

## 5. Deposits

**Decision: a deposit is never a `Payment` row.** It is held as a separate
admission-level credit, only ever converted into a real `Payment` by an
explicit settlement action - never automatically the moment it is taken.

### Why not record it as a `Payment` against the running-bill invoice

`isLocked(inv) = inv.payments.some(p => !p.reversedAt) || !!inv.claim`
(`billing.service.ts:659`) is a load-bearing invariant: FUNC-2 and the item
9 audit work both depend on "a live payment means the invoice is locked
against silent edits" meaning exactly that, everywhere. If a deposit were
recorded as a `Payment`, the running-bill invoice would lock **the moment
the first deposit is taken** - day one of a two-week stay - and every
following bed-day charge would spawn a fresh supplementary invoice (FUNC-2's
existing mechanism, working exactly as designed) rather than accumulating on
one bill. That is not a bug in FUNC-2; it is FUNC-2 doing precisely what it
was built to do. But it would fragment a long admission into a new invoice
every single night, which is the wrong shape for a running bill and not
what "deposit" means in hospital billing - a deposit is held *against* the
eventual bill, it does not *settle* any of it yet.

The alternative considered and rejected: special-case `isLocked()` so an
admission's invoice does not lock on a live payment while the admission is
still open. Rejected because it weakens a deliberately strict invariant
everywhere it is checked (`updateInvoice`, `addInvoiceLine`,
`updateInvoiceLine`, `removeInvoiceLine`, claim generation, item 9's whole
audit trail) for one call site's convenience - and it would need to keep
distinguishing "this payment was a deposit application" from "this payment
really does mean settled," which is exactly the distinction the credit-
ledger design below gives for free, without touching `isLocked` at all.

**This does not mean a deposit is invisible to cash control** - the
opposite: section below makes every deposit/top-up/refund show up exactly
where a cashier's physical cash drawer would expect it to.

### Schema

```prisma
model AdmissionDeposit {
  id             String    @id @default(uuid())
  tenantId       String
  tenant         Tenant    @relation(fields: [tenantId], references: [id])
  admissionId    String
  admission      Admission @relation(fields: [admissionId], references: [id])
  amount         Decimal   @db.Decimal(12, 2)
  method         String    // CASH | CARD | TRANSFER
  reference      String?
  receiptNumber  String?   // same sequence/prefix convention as Payment.receiptNumber
  receivedById   String?
  receivedAt     DateTime  @default(now())
  refundedAmount Decimal?  @db.Decimal(12, 2)
  refundedAt     DateTime?
  refundedById   String?
  refundReason   String?

  @@index([tenantId])
  @@index([admissionId])
}
```

### API

- `POST /admissions/:id/deposits` `{ amount, method, reference? }` - records
  a deposit or a top-up (same endpoint, called again). Never touches
  `Invoice`/`Payment`. Allocates a `receiptNumber` via the same
  `nextSequence`-backed convention `Payment.receiptNumber` already uses
  (`billing.service.ts`'s `nextNumber(tx, tenantId, 'RCP')`), so a deposit
  receipt number sits in the same numbering scheme a payment receipt does.
  Permission `admission:deposit` (new action: ACCOUNTANT, RECEPTIONIST,
  HOSPITAL_ADMIN - the billing-desk roles, not clinical ones, matching
  `billing:manage`'s own role set since this is money handling).
- `GET /admissions/:id/deposits/:depositId/receipt` - a printable receipt
  (new `DepositReceiptPrintModal`, same hospital-letterhead/A4 pattern item
  10 built for prescriptions and lab reports), clearly headed **"Deposit
  received"** for a deposit/top-up and **"Deposit refund"** for a refund -
  never worded or laid out like an invoice payment receipt, so cash
  reconciliation can tell the two apart at a glance.
- `POST /admissions/:id/apply-deposit` `{ amount }` - the explicit interim-
  settlement action: converts up to `amount` of *available* deposit credit
  (section below) into a real `Payment` against the admission's currently
  open invoice, via the existing `addPayment` path unchanged. This **does**
  lock that invoice, on purpose - once deposit money is formally applied
  against specific charges, those charges are paid and deserve the same
  protection against silent editing as any other paid invoice. The next
  charge after this naturally opens a supplementary invoice
  (`resolveOpenInvoiceForAdmission`, unchanged FUNC-2 mechanism) - a
  multi-invoice running bill across a long stay, each interim-settled
  chunk preserved immutably, is the correct shape, not an edge case to work
  around. This conversion is revenue recognition happening at exactly the
  moment it should (section below).
- `POST /admissions/:id/deposits/:depositId/refund` `{ amount, reason }` -
  partial or full refund of one deposit; blocked if `amount` exceeds
  `deposit.amount - (deposit.refundedAmount ?? 0)`. **Permission
  `admission:deposit-refund`** (new, **narrower** than `admission:deposit`:
  ACCOUNTANT, HOSPITAL_ADMIN only, not RECEPTIONIST) - a deliberate
  separation of duties: whoever can take a deposit should not be able to
  unilaterally hand cash back out without accountant/admin sign-off.
  Required `reason`. Audited (`DEPOSIT_REFUND`, before/after, same shape as
  the item 9 line-edit audit). Issues its own printable receipt (above).
- `GET /admissions/:id/bill` (section 9) includes `totalDeposited`
  (sum of `amount - refundedAmount` across deposits - i.e. credit not yet
  applied as a Payment and not yet refunded) alongside the invoice-derived
  totals.

### Cash reconciliation: the payment ledger shows every cash movement, not just invoice payments

`ReportsService.payments()`/`paymentsCsv()` (the existing payment ledger -
`reports.service.ts`) is extended to **union** `AdmissionDeposit` rows
(taken and refunded) alongside `Payment` rows, each tagged with a `kind:
'PAYMENT' | 'DEPOSIT' | 'DEPOSIT_REFUND'` and labelled accordingly in the
ledger table and its CSV export, with the same date-range/department/doctor
filters already applied uniformly. This is the point of the whole
no-`Payment`-row design: a deposit is still **cash the cashier physically
collected**, and the cashier's end-of-day reconciliation must see it right
alongside every invoice payment they took that day, not in a separate,
easy-to-forget place.

### Revenue recognition stays exactly as it is today

`ReportsService.overview()`'s finance KPIs ("Total Collection," revenue,
etc.) are **not modified** to include raw deposits - they continue to sum
only real `Payment` rows and billed `Invoice` totals, unchanged. An
`apply-deposit` call *does* create a real `Payment`, so that portion is
correctly recognised as revenue **at the moment it is actually applied
against a charge**, not when the cash first came in - exactly matching the
brief's instruction. A new, separately labelled KPI - **"Deposits held"**
(sum of `totalDeposited` across every currently open admission) - is added
alongside the finance KPIs, explicitly described in its own UI copy as a
liability/credit held, not revenue, so it is never mistaken for income on a
financial summary.

### Balance, computed as a view - never a stored field

The running bill is an **admission-level aggregate computed fresh on every
read**, not a new persisted total:

- `totalCharged` = sum of `totalAmount` across every `Invoice` with this
  `admissionId` (primary + any supplementary).
- `totalPaid` = sum of real `Payment`s (not reversed) across those same
  invoices - this already includes anything applied via
  `apply-deposit`, since that endpoint posts an ordinary `Payment`.
- `totalDeposited` = unapplied, unrefunded deposit credit (section above).
- `balance` = `totalCharged - totalPaid - totalDeposited`. Positive = still
  owed; negative = credit beyond what is owed, refundable.

This is deliberately **not** the same number as any single invoice's own
`balanceDue` (that field only ever reflects its own invoice's lines and
payments, unchanged) - it is a view assembled across all of an admission's
invoices plus its deposit ledger, specifically for the interim/final bill
(section 9), the patient banner (below) and the discharge settlement gate
(section 8).

### Patient banner

While a patient has an active (`ADMITTED`) admission, the patient chart
header and the inpatient workspace (section 4) both show **"Deposit held:
₦X"** live, sourced from the same `totalDeposited` figure `GET
/admissions/:id/bill` already computes - so a ward nurse or a doctor can see
at a glance, without opening billing, whether there is deposit credit on
file for this stay.

### Refunds never require reversing a Payment, by construction

The settlement actions above are deliberately written to convert **at most**
`min(availableDeposit, amountOwed)` into a real `Payment` - never more. Any
deposit beyond what was actually owed stays as `AdmissionDeposit` credit and
is refunded directly through the deposit-refund endpoint above, with no
`Payment` ever created for the excess and therefore nothing to reverse. An
overpayment-via-deposit-application should not be able to happen if this
rule is followed consistently in both `apply-deposit` and the discharge
settlement step (section 8); it is called out explicitly here as an
implementation invariant to test for (section 13), not merely a hope.

## 6. Bed/ward charges

### Rate source

```prisma
model Ward {
  // ...existing fields...
  dailyRate   Decimal? @db.Decimal(12, 2)
  dayCaseRate Decimal? @db.Decimal(12, 2)
}
```

One mutable `dailyRate` per ward, admin-editable from the existing Wards
admin screen (no history table needed for v1: changing a rate only affects
*future* nights, since a night already charged is a frozen `InvoiceLine`
with its own `unitPrice` - changing `Ward.dailyRate` tomorrow cannot alter
an invoice line already posted today). `dailyRate` is `null` until an admin
sets it. `dayCaseRate` is optional and only required if the hospital chooses
`DAY_CASE_RATE` below for a ward that can actually have a short stay.

**Corrected: a missing rate never blocks the admission or transfer itself**
(the original design's hard `BadRequestException` was wrong - clinical need
to admit a patient must never wait on billing setup). `admit`/`transfer`
succeed regardless, and write a `WARD_RATE_MISSING` audit entry; the
admitting/transferring user gets a toast warning immediately, the admission
itself shows a persistent "Ward rate not set - bed charges on hold" banner
(inpatient workspace and wards board), and Hospital Admin/Accountant see
every such admission on their dashboard ("Ward rate not set" widget,
`home.service.ts`, linking to the wards board to fix it) until a rate is
set. F1b's daily bed-charge job is written to be naturally idempotent and
catch-up-safe over every uncharged past night (keyed by `BedDayCharge`'s
`[admissionId, nightOf]` uniqueness) rather than only "yesterday" - so once
a rate is set, every night that passed with no rate posts automatically, at
the rate now in effect, exactly once each. The same applies to
`DAY_CASE_RATE` with no `dayCaseRate` set: it holds rather than blocks.

### Charging rule (per-hospital, configurable, defined precisely)

```prisma
enum InpatientChargeRule {
  MIDNIGHT_CENSUS
  ROLLING_24H
}

enum ShortStayChargeMode {
  NONE               // a stay crossing no charge boundary is free
  MINIMUM_FULL_DAY   // charged one full night at the ward's dailyRate
  DAY_CASE_RATE      // charged once at the ward's own, separate dayCaseRate
}

model Tenant {
  // ...existing fields...
  inpatientChargeRule           InpatientChargeRule  @default(MIDNIGHT_CENSUS)
  shortStayChargeMode           ShortStayChargeMode  @default(MINIMUM_FULL_DAY)
  requireSettledBillAtDischarge Boolean              @default(false)
}
```

Editable from Settings (`SettingsService`/`HospitalSettingsDTO`, same
pattern as `invoicePrefix` etc.) - two dropdowns + one toggle.

- **`MIDNIGHT_CENSUS`** (default - the standard hospital convention): one
  bed-day is charged for every Lagos midnight (`lagosCalendarDate` /
  `startOfDayLagos` from `common/lagos-time.ts`, the same helper Batch A
  built) at which the patient is still an open `Admission` occupying a bed.
  The ward charged for that night is whichever `AdmissionWardStay` (below)
  was open at the midnight instant itself.
- **`ROLLING_24H`**: one bed-day per full-or-partial 24-hour block measured
  from the exact `admittedAt` timestamp, independent of calendar midnight,
  **for any block beyond the first** - see below for how the first block of
  a genuinely short stay is treated. The ward charged for a block is
  whichever `AdmissionWardStay` was open at **the instant that block
  ends** - the same "which stay was open at this one instant" rule
  `MIDNIGHT_CENSUS` uses, just evaluated at a different instant, rather than
  a separate majority-of-the-block calculation. This keeps both rules
  sharing one mechanism and avoids the need to apportion a single block
  across two wards.

### Short stays: a unified, midnight-based definition under either rule

**"Doesn't cross a charge boundary" is defined as zero Lagos midnights
crossed during the whole admission** - this is a single, midnight-based
test applied **regardless of which `InpatientChargeRule` the hospital has
chosen**, because "day case" is fundamentally a same-calendar-day concept in
real hospital billing, not an artefact of one particular counting rule:

- **Zero midnights crossed** (the entire stay happened within one calendar
  day) → `shortStayChargeMode` decides the charge, the same way under
  *either* `inpatientChargeRule`:
  - `NONE` → no charge at all.
  - `MINIMUM_FULL_DAY` (default) → one full night at the ward's `dailyRate`.
  - `DAY_CASE_RATE` → one charge at the ward's own `dayCaseRate`. If the
    ward has no `dayCaseRate` set, this **holds** the same way a missing
    `dailyRate` does (section 6's "Rate source" above) - flagged on the
    admission and the admin/billing dashboard, posted automatically once a
    rate is set - never a silent fallback to the full `dailyRate`.
- **One or more midnights crossed** → `shortStayChargeMode` does not apply
  at all; the chosen `inpatientChargeRule` governs every night/block exactly
  as described above, unchanged from the original design.

This means `ROLLING_24H`'s very first block is **not** unconditionally
rounded up the way a later block is: if the *entire* admission never reaches
even one Lagos midnight, `shortStayChargeMode` decides the charge instead of
the rule's own "full-or-partial block" rounding. A longer stay's genuine
trailing partial day (the normal case - a multi-night stay that ends a few
hours into what would have been the next block) is unaffected and still
rounds up to a full charge as before; only a stay that never crosses a
single midnight at all is redirected to `shortStayChargeMode`.

### Worked examples, both rules, per the brief

| Scenario | Midnights crossed | `MIDNIGHT_CENSUS` | `ROLLING_24H` |
|---|---|---|---|
| Admitted 23:00, discharged 08:00 next day | 1 | **1 night**, normal rule applies (short-stay setting does not apply) | **1 day**, normal rule applies (9h, partial block rounds up) |
| Admitted 09:00, discharged 17:00 same day | 0 | `shortStayChargeMode` applies: `NONE` → **0**; `MINIMUM_FULL_DAY` (default) → **1 night at `dailyRate`**; `DAY_CASE_RATE` → **1 charge at `dayCaseRate`** | **Identical to the `MIDNIGHT_CENSUS` column** - `shortStayChargeMode` applies the same way regardless of the chosen rule, since zero midnights were crossed either way |
| Admitted Day 1 10:00 (Ward A), transferred Day 1 15:00 to Ward B, discharged Day 2 10:00 | 1 | **1 night, Ward B's rate** (Ward A is never charged - no midnight occurred while the stay was open there) | **1 day, Ward B's rate** (the one 24h block ends in Ward B) |

The middle row is where the short-stay setting is the whole story, and is
now identical under both rules by design - exactly the flexibility the
brief asked for, available to a hospital regardless of which multi-day
counting rule it otherwise prefers. The bottom row is unaffected by this
change (at least one midnight is crossed, so the normal per-rule mechanics
apply exactly as before) and shows why `MIDNIGHT_CENSUS` has no transfer-
attribution ambiguity to resolve (a transfer before the only midnight in the
stay means Ward A simply never had an open stay at any census point), while
`ROLLING_24H` needs the explicit "ward at block end" rule to get a
well-defined answer at all.

**Confirmed: both the day-counting rule and the short-stay mode are
per-hospital settings**, not fixed system rules - `Tenant.inpatientChargeRule`
and `Tenant.shortStayChargeMode`, both editable from Settings alongside
every other per-tenant toggle.

### Ward-stay history (needed for correct per-night billing across a transfer)

`Admission.wardId`/`bedId` only reflect the *current* location - a transfer
overwrites them, so the day-charging logic cannot ask "what ward was this
admission in on the night of the 14th" from the admission row alone.

```prisma
model AdmissionWardStay {
  id          String    @id @default(uuid())
  tenantId    String
  tenant      Tenant    @relation(fields: [tenantId], references: [id])
  admissionId String
  admission   Admission @relation(fields: [admissionId], references: [id])
  wardId      String
  ward        Ward      @relation(fields: [wardId], references: [id])
  bedId       String
  bed         Bed       @relation(fields: [bedId], references: [id])
  startedAt   DateTime
  endedAt     DateTime?

  @@index([admissionId])
}
```

`admit()` creates the first row (`startedAt = admittedAt`, `endedAt = null`).
`transfer()` closes the current row (`endedAt = now()`) and opens a new one
for the destination ward/bed. The day-charging logic (below) looks up which
`AdmissionWardStay` row was open at each night's census point and charges
that ward's current `dailyRate` - so a transfer never double-charges a day
(exactly one stay row, and therefore exactly one ward, is "open" for any
given night) and a mid-stay rate change never touches a night already
charged.

### When bed-day charges are posted

A daily job, following `renewal.service.ts`'s tenant-iteration pattern,
shipped as `BedChargesService.postNightlyBedCharges()`:

```ts
@Cron('5 0 * * *', { timeZone: 'Africa/Lagos' })
async postNightlyBedCharges() { /* iterate active tenants, then each ADMITTED admission, via forTenant */ }
```

**Confirmed to actually fire at 00:05 Lagos time regardless of server
deployment timezone**: rather than a UTC-offset cron string (`'5 23 * * *'`,
relying on the server process running in UTC - the PROD-4 assumption this
codebase explicitly avoids everywhere else), the job passes an explicit
`timeZone: 'Africa/Lagos'` to `@Cron` and writes the cron expression in that
zone's own local time (`'5 0 * * *'`). `@nestjs/schedule`'s `CronOptions`
supports this directly (confirmed in its type definitions); it is correct no
matter what timezone the deployment host itself runs in.

For each `ADMITTED` admission in each tenant: determine whether a given
night/block has already been charged via the `BedDayCharge
{ admissionId, nightOf, invoiceLineId }` marker table - enforced by a real
DB-level `UNIQUE (admissionId, nightOf)` index (confirmed via `psql \d
"BedDayCharge"`: `BedDayCharge_admissionId_nightOf_key`), not just a
Prisma-level check, so two concurrent writers for the same night can never
both succeed. Post one `InvoiceLine` at the ward-at-that-night's current
`dailyRate` via `postCharge` (category `"Inpatient"`, description `"Ward
stay - <ward name> - <date>"`).

**Concurrency**: `BillingService.postChargeToAdmission`'s own
per-admission advisory lock (`pg_advisory_xact_lock`, transaction-scoped)
serializes two concurrent attempts to charge the same admission - whether
that is the nightly cron racing discharge's own reconciliation, or two
server instances both running the cron. The second writer's transaction
rolls back whole (its own invoice line included) the moment it hits the
unique-index conflict, rather than leaving a duplicate or a half-posted
charge; the next run recomputes from scratch and only finds genuinely
still-missing nights. Tested directly (`bed-charges.int-spec.ts`): two
concurrent calls for the same admission/window produce exactly one charge
per night, never two.

**Catch-up uses the rate current at posting time - there is no rate
history.** A held night (missing `dailyRate`/`dayCaseRate` at the moment it
was due) gets no `BedDayCharge` row at all, so it is retried on every
subsequent run until a rate exists; when it finally posts, it posts at
whatever rate is set *then*, not any rate that may have been in effect on
the night itself. A missed cron run entirely (the process asleep, or down
for a deploy) is likewise caught up automatically - the plan is always
recomputed from the admission's full history, not "since the last run" - by
either the next cron tick or, for an admission that discharges before the
cron ever gets to it again, by discharge's own final reconciliation.

At **discharge**, before closing the admission: run the same per-night
reconciliation up to the discharge instant (so a patient discharged at 6am
is correctly billed for the night just passed even though the 00:05 cron
has already run and - depending on exact timing - may or may not have seen
this admission), and apply the short-stay rule (above) if the whole
admission turns out to have crossed zero midnights. This makes discharge
the authoritative "final settle" step regardless of cron timing.

### Transfers: no double charge for the same day

Guaranteed structurally, not by a special case: at any instant exactly one
`AdmissionWardStay` row is open for an admission, so the nightly job (and
the discharge reconciliation) can only ever attribute one ward to one night.

## 7. HMO inpatients: one claim per episode

`Admission.payerType`/`hmoName`/`authCode` already exist and already flow
through `admit()`/`update()` - no schema change needed to *capture* the
pre-auth code. Optional at admission time (emergencies often admit before
authorization comes through) but required before a claim can be generated.

**The real change is in claims.** Today `InsuranceClaim.invoiceId` is a
`@unique` nullable FK - one claim per invoice. An admission's running bill
can legitimately span more than one invoice (a primary plus a supplementary
if an interim payment or an earlier claim locked it mid-stay, same FUNC-2
mechanism as outpatient). `InsuranceClaimLine.invoiceLineId` is already a
bare, unconstrained string, not a real foreign key - so a claim's lines were
never actually required to come from one invoice; this makes spanning
invoices a non-breaking extension, not a redesign.

```prisma
model InsuranceClaim {
  // ...existing fields...
  admissionId String?
  admission   Admission? @relation(fields: [admissionId], references: [id])
}
```

`invoiceId` stays as-is for outpatient claims. For an admission claim,
`invoiceId` is left null and `admissionId` is set instead; a **new**
`generateForAdmission(admissionId)` method is added alongside the existing
`generate(dto.invoiceIds)` - `generate()` itself is not modified, so every
outpatient call site and test behaves exactly as today. Given an
`admissionId`, the new method gathers every `Invoice` with that
`admissionId` (primary + any supplementaries), pulls their lines, and
creates **one** `InsuranceClaim` with `InsuranceClaimLine` rows drawn across
all of them - never per invoice, never per day. Generation is only offered
once the admission is `DISCHARGED` (the bill is final at that point) and
`authCode` is set (blocked with a clear message otherwise, not a silent
skip).

### Every place that assumes one claim : one invoice, checked directly against `claims.service.ts`

| Site | Today | Change needed | Outpatient impact |
|---|---|---|---|
| `generate()`'s per-invoice loop (`claims.service.ts:360-471`) | Iterates `dto.invoiceIds`, one claim per id | **None** - untouched; `generateForAdmission` is a separate method | None - identical code path |
| Duplicate-claim check (`:385`, `where: { invoiceId: invoice.id, ... }`) | "does a claim already exist for this invoice" | `generateForAdmission` uses the equivalent check keyed on `admissionId` instead | None - outpatient check unchanged |
| Claim creation (`:442`, `invoiceId: invoice.id`) | Sets the 1:1 FK | `generateForAdmission` sets `admissionId` and leaves `invoiceId` null | None |
| **Remittance allocation / payment posting** (`:1048-1063`, `:1170`, `postAdjustment`/`recomputeInvoice(tx, claim.invoiceId)`) | Posts the approved/paid amount, and any write-off, **directly against `claim.invoiceId`** | **The real structural change.** Generalise to resolve the claim's underlying invoice(s) from its lines (`InsuranceClaimLine.invoiceLineId` → `InvoiceLine.invoiceId`, grouped), then post each invoice's share of the remittance/write-off against it and `recomputeInvoice` each one - instead of assuming a single `claim.invoiceId`. For an outpatient claim this resolves to exactly the one invoice it always had, so behaviour is identical; the generalisation subsumes the old single-invoice case rather than branching around it. | **None, if done as a generalisation rather than a special case** - confirmed by construction: a claim with one invoice's worth of lines always resolves to that one invoice |
| Write-off posting (`:620-621`, `postAdjustment(tx, tenantId, claim.invoiceId, ...)`) | Same single-invoice assumption | Same generalised per-invoice resolution as the row above | None |
| **Claim batches** (`batchCsv`, `:855-888`) | Lists claim number, patient, member #, auth code, service date, diagnosis, claimed amount | **No change** - confirmed by reading the method: it never references `invoiceId`/an invoice at all, it is entirely claim-centric | None |
| **CSV / schedule export** | Same `batchCsv` method as above | **No change**, same reason | None |
| **Aging / outstanding** (`agingBuckets`/`addAging`/`outstanding`, `:1232-1284`) | Computed from the claim's own `claimedAmount`/`approvedAmount`/`paidAmount`/`writeOffAmount` and `submittedAt` | **No change** - confirmed by reading `this.outstanding(c)`'s inputs: never touches `invoiceId` | None |

**Outpatient claims behave exactly as today**, confirmed two ways: (1)
`generate()` is not modified at all, only joined by a new sibling method;
(2) the one place that genuinely must change - remittance/write-off
posting - is changed as a generalisation that resolves to the identical
single invoice for any claim that only ever had one, not as a branch that
could diverge for the outpatient case.

### Confirming every existing claim's lines actually resolve - before relying on it

The generalised remittance logic (table above) depends on every
`InsuranceClaimLine.invoiceLineId` being set and pointing at a line that
really belongs to that claim's own `invoiceId`. Checked at the code level,
not assumed: a full-codebase grep for `insuranceClaimLine.create`/
`createMany` turns up **exactly one call site**
(`claims.service.ts:556`), fed entirely from `invoice.lines.map(l => ({
invoiceLineId: l.id, ... }))` (`:419-426`) - the real invoice's own lines,
in the same transaction that sets `invoiceId` on the claim itself. There is
no other code path, migration, or seed script that has ever created an
`InsuranceClaimLine` row. By construction, every existing claim line's
`invoiceLineId` should already point at a line belonging to its own claim's
`invoiceId`.

**This is still being treated as "needs confirming," not "proven," before
F1d ships**, per the brief:

1. A verification query is run against the real tenant data as part of
   F1d, before the generalised remittance code goes live:
   ```sql
   -- any claim line with no invoiceLineId at all
   SELECT count(*) FROM "InsuranceClaimLine" WHERE "invoiceLineId" IS NULL;
   -- any claim line whose resolved invoice disagrees with its own claim's invoiceId
   SELECT cl.id FROM "InsuranceClaimLine" cl
     JOIN "InvoiceLine" il ON il.id = cl."invoiceLineId"
     JOIN "InsuranceClaim" c ON c.id = cl."claimId"
   WHERE c."invoiceId" IS NOT NULL AND il."invoiceId" != c."invoiceId";
   ```
2. This same pair of checks is written as a permanent integration test
   (section 13) run against the seeded/test database in CI, not just a
   one-off migration-time script, so the invariant stays checked going
   forward as new claims are created.
3. **If either query ever finds a row** (not expected, given the single-
   creation-path proof above, but checked rather than assumed): a backfill
   migration re-derives the correct `invoiceLineId` for that row by matching
   the claim's own `invoiceId`'s lines on description + amount, and any line
   that cannot be confidently matched is flagged in the migration's output
   for manual review rather than silently guessed at.
4. **Full before/after regression**, run once as part of F1d and kept as a
   permanent test: generate an outpatient claim → batch it → export the
   batch CSV → record a remittance → post a write-off → check aging -
   compare every result against the same sequence run before this change,
   on data untouched by admissions, and assert byte-for-byte/value-for-value
   identical output.

## 8. Discharge

### Settlement gate

Discharge first runs the final night's reconciliation (section 6), then
**automatically applies available deposit credit** via the same
`apply-deposit` mechanism (section 5), capped at `min(availableDeposit,
amountOwed)` - this is the one place deposit application happens without a
separate staff click, since "settle what's owed from the deposit on hand"
is exactly what discharge is supposed to do. Only the balance left *after*
that automatic application is subject to the gate below. **`amountOwed`
here means the patient's own payable amount, not the invoice's raw
balance** - for an HMO admission this excludes whatever is still expected
from the HMO (see "Deposits and HMO cover" below) - so the gate, like
apply-deposit itself, is never evaluated against money the HMO, not the
patient, is expected to pay.

`Tenant.requireSettledBillAtDischarge` (section 6) - default **off**, so
F1 never blocks a clinical discharge by default (a hospital should not be
forced to choose this feature to keep discharging patients the way they do
today). When on: `discharge()` is blocked if the post-deposit-application
patient-payable balance is greater than zero, with a clear message naming
the amount owed. **Override**: a Hospital Admin can discharge anyway with
`admission:discharge-unsettled` (new permission, HOSPITAL_ADMIN only) +
a required reason, audited (`DISCHARGE_UNSETTLED_OVERRIDE`, metadata:
balance, reason) - the same override-with-reason shape used throughout this
codebase (FUNC-1 off-formulary, item 9 line edits).

### Deposits and HMO cover

**A deposit is applied only to the patient-payable portion of the balance -
co-pay, excluded or uncovered items - never to the amount still expected
from the HMO.** This applies everywhere a deposit is converted into a real
Payment: the explicit `apply-deposit` endpoint and discharge's automatic
step both resolve the patient's own share via `AdmissionsService
.patientPayableBalance()` before capping the amount, rather than using the
invoice's raw outstanding balance.

**How the split is determined today** (there is no persisted per-line or
per-invoice patient/HMO split anywhere in the schema - confirmed by reading
`Invoice`/`InvoiceLine`/`Admission` directly - so this reuses the one real
primitive that already exists, `InsuranceProvider.defaultCoPayPct`, the same
one `claims.service.ts generate()` already uses to split a claim):

1. Not an HMO admission (`payerType !== 'HMO'`) - the whole balance is the
   patient's, exactly as today.
2. An admission claim already exists (F1d's `generateForAdmission`) -
   whatever the HMO still has outstanding on it
   (`claimedAmount - paidAmount - writeOffAmount`) is reserved; the rest of
   the balance is the patient's.
3. No claim yet (the common case before F1d ships, and mid-stay even after)
   - estimate the patient's share via the patient's own linked
   `InsuranceProvider.defaultCoPayPct` (falling back to a name match on
   `hmoName`, the same resolution order `generate()` uses), applied to the
   current balance. This is an estimate, not a reservation - it can only
   ever be checked against a real claim once one exists.

**If an HMO later rejects part of a claim (or pays less than claimed and
the hospital does not write off the shortfall), the patient portion grows -
by construction, not a special case.** Once a claim reaches a resolved
status (`PAID`/`REJECTED`/`WRITTEN_OFF`/`CANCELLED`), "still expected from
the HMO" becomes zero for that claim; whatever of `claimedAmount` was never
actually paid, and was not separately written off, simply falls out of the
`balance - hmoStillExpected` subtraction and becomes ordinary patient-
payable balance - the same balance a deposit or a fresh payment can cover
like any other. No reconciliation step is needed to "move" the money across
a boundary; the boundary is recomputed fresh every time `patientPayableBalance()`
runs, from the claim's current state.

### Deposit refund at discharge - corrected: never blocks

**Original design, corrected after review**: discharge was first specified
to *require* recording the refund (method + reference) before it could
complete whenever credit remained. That was wrong - a cash-handling step
must never be allowed to hold up a clinical discharge, the same principle
that already governs the settlement gate above (off by default, override
available) and the ward-rate hold (section 6). Billing/cashier availability,
a patient who has already left, or simply "deal with it later today" are
all ordinary reasons the refund cannot happen at the exact moment of
discharge.

**Corrected behaviour**: if credit remains after automatic application,
discharge records a **pending refund** (`AdmissionRefund`: amount,
admission, requested-by, reason) and completes regardless - the refund
shows on the admission itself and on a tenant-wide "refunds due" list for
billing/cashier (`GET /admissions/refunds/due`, `admission:deposit-refund`).
Paying it out later (`POST /admissions/:id/refunds/:refundId/pay`) draws
down the admission's deposits exactly as an immediate refund would (same
`refundDepositsInternal` allocator, oldest deposit first) and issues the
same printable receipt and cash-ledger entry an immediate refund would -
nothing about the cash-handling mechanics changed, only when it is allowed
to happen. If refund details *are* given inline at the moment of discharge
(the common case when a cashier is right there), it still pays out
immediately within the same transaction - a pending `AdmissionRefund` row
is created either way, but is marked `PAID` at once rather than left
`PENDING`, so the audit trail is identical in shape regardless of timing.
A refund can only ever be paid once (`payRefund` rejects a refund already
`PAID`) and a pending refund is excluded from "deposits held" on both the
admission and the tenant-wide KPI (section 10) - it is owed to the patient,
not available credit - with its own separate "Refunds owed" liability line.

### Discharge summary

`Admission.dischargeNotes` already exists (free text). A "basic" discharge
summary, per the brief, assembles what already exists rather than
collecting anything new: diagnoses recorded against the admission (section
3's new `Diagnosis.admissionId`), medications prescribed during the stay
(`Prescription.admissionId`), investigations ordered/resulted
(`ClinicalOrder.admissionId`), and the free-text discharge notes and
condition-at-discharge. Printed via the same A4 print pattern item 10 built
(`PrescriptionPrintModal`/`LabReportPrintModal`'s shared approach) - a new
`DischargeSummaryPrintModal` reusing the hospital-letterhead fetch from
`/settings`.

## 9. Interim bills

`GET /admissions/:id/bill` - admission info, ward/bed history, deposits
(with refund status and receipt links), every invoice for this
`admissionId` (primary + supplementary, each with its own lock state
exactly as the billing drawer already computes it), running totals
(charged, deposited, balance). Printable at any time during the stay via
the same A4 print component used for the final bill/discharge summary,
labelled "Interim bill - stay in progress" vs. "Final bill" so a mid-stay
printout is never mistaken for the closing statement.

### F1b implementation notes

- The day-counting logic shipped as a pure function, `planBedCharges()` in
  `apps/api/src/admissions/bed-charges.ts`, deliberately separated from any
  DB access so every worked example in this doc (section 6) is a direct unit
  test (`bed-charges.spec.ts`), independent of wall-clock time. The DB-aware
  wrapper, `BedChargesService` (`bed-charges.service.ts`), does the
  idempotency check (`BedDayCharge`), resolves the right `AdmissionWardStay`
  for each census instant, and posts the charge via `BillingService.postCharge`
  - called by both the nightly cron and `AdmissionsService.discharge()`
  (`isFinal: true`, run **before** the ward-stay row closes, so the very last
  census point still resolves correctly). `BedDayCharge.invoiceLineId` became
  nullable (migration `20261001010000_f1b_bed_charges`): a null row means
  "evaluated, legitimately free" (`ShortStayChargeMode.NONE`), not "pending" -
  a held night/stay (missing rate) gets no row at all, so the next run
  retries it at whatever rate is current then.
- **Orders from the inpatient workspace**: rather than a parallel
  `AdmissionsService.createOrder`, `EncountersService.createOrder`'s second
  parameter was generalised from a bare `visitId: string` to
  `string | { admissionId: string }` - every existing call site (a bare
  string) is unaffected, and `AdmissionsController` calls the same method
  with `{ admissionId }`. The completed-admission guard mirrors the
  completed-visit one exactly (`AdmissionStatus !== 'ADMITTED'` blocks new
  orders, matching section 4's equivalence table).
- **SOAP notes/addenda on an admission were deferred out of F1b's explicit
  "charges and orders" scope, then moved back into F1c** once a clear
  product requirement landed (daily ward-round notes, not an edge case) -
  see the F1c implementation notes below for how they actually shipped,
  which is not the single-upsertable-note shape a visit has.
- **Interim/final bill print**: one shared component
  (`AdmissionBillPrintModal`), fed by `GET /admissions/:id/bill` (now
  including each invoice's line items, not just a count), labelled "Interim
  bill" while `AdmissionStatus === 'ADMITTED'` and "Final bill" once
  discharged - exactly as this section specifies.

### F1c implementation notes

- **Admission notes are many dated rows, not a single upsertable one.** The
  design doc's section 4 table originally claimed "no change needed" for
  notes on an admission, reasoning from a visit's one-note-per-encounter
  shape. That was wrong for the real requirement (daily ward rounds): an
  admission needed `ClinicalNote.admissionId` queryable but **not** unique
  (many rows, each a new `create`, never an `upsert`), and
  `ClinicalNoteAddendum` needed a way to target **one specific** note rather
  than "the visit's only note" - so it gained a nullable `noteId` (+
  `admissionId`, denormalised for simple workspace queries) alongside its
  existing `visitId`, which stayed required-turned-optional but otherwise
  untouched for every existing visit addendum. Migration
  `20261001020000_f1c_deposits_notes`. The guard and addendum semantics
  are otherwise exactly the FUNC-2 shape: blocked once closed unless
  reopened (`admission:reopen`), addenda always allowed, author + timestamp
  on every row.
- **Deposit application needed its own pool, which the original design
  missed.** Section 5's schema plan had `refundedAmount` but no
  `appliedAmount` - meaning `apply-deposit` (converting credit into a real
  `Payment`) had nothing to decrement, so a deposit's "available for refund"
  balance would have stayed wrong (double-countable) the moment any of it
  was applied. Added `AdmissionDeposit.appliedAmount`; every "available
  credit" calculation everywhere in the codebase (`workspace()`, `bill()`,
  `dischargeSummary()`, `refundDeposit()`, `applyDeposit()`, discharge's
  auto-apply) now reads `amount - appliedAmount - refundedAmount` from the
  same pool. `apply-deposit` and discharge's automatic step share one
  allocator (`AdmissionsService.applyDepositInternal`): oldest deposit
  first, and for each deposit, oldest unpaid/partial invoice first - the
  same FEFO shape pharmacy stock draw-down already uses, just applied to
  deposit credit - posting one real `Payment` per (deposit, invoice) pair
  actually drawn from via a new `BillingService.postPaymentTx` (no
  actor/permission check of its own; the caller's own action gate already
  covers who may trigger it - `admission:discharge` for the automatic step).
- **A second, independent gap found in the same area**: `refundDeposit()`
  (built in F1a) generated a refund receipt number, recorded it in the
  audit log, and returned it once - but never persisted it, so
  `depositReceipt()` could not re-fetch a refund's own receipt later
  (it silently redisplayed the original deposit-taken receipt number
  instead). Added `AdmissionDeposit.refundReceiptNumber`, a field distinct
  from the deposit-taken `receiptNumber`, migration
  `20261001030000_f1c_deposit_refund_receipt`. Discharge's own refund step
  (`refundDepositsInternal`) can refund **across more than one deposit** in
  a single discharge event (if the remaining credit spans several), all
  under one shared refund receipt number.
- **Reopen never changes `AdmissionStatus`**, exactly as section 4
  specified - `reopen()` only sets `reopenedAt` and calls the already-
  generalised `flagReopenedInvoices(tx, { admissionId })`. The
  closed-admission guard everywhere (notes, orders, prescriptions) checks
  `status !== 'ADMITTED' && !reopenedAt`, so one reopen call permanently
  lifts it for that admission - there is no "re-locking" action, the same
  as a reopened visit has no path back to blocked either.
- **Discharge summary** assembles diagnoses/prescriptions/notes plus the
  final bill totals directly from `tx` inside `dischargeSummary()`'s own
  transaction, rather than calling the already-transactional `bill()`
  method from within another transaction (which would have opened a second,
  wasteful, independently-tenant-scoped transaction).

## 10. Reports

- **Census / bed occupancy**: a new reports panel - beds occupied vs. total
  per ward, right now (a simple `Bed.status` groupBy, no new model needed).
  Admissions-per-day trend using the same `buildBuckets`/`lagosCalendarDate`
  machinery `reports.util.ts` already has.
- **Inpatient revenue**: `ReportsService.overview()`'s finance KPIs
  currently sum all non-cancelled invoices in the window regardless of
  category - inpatient invoices (`Invoice.admissionId != null`) are
  automatically included once they exist, no code change needed there. Add
  one explicit "Inpatient revenue" KPI (sum where `admissionId != null`) so
  it is visible as its own line rather than hidden inside the total.
- **"Deposits held"** - a new, separately labelled balance/liability KPI
  (section 5), never mixed into the revenue figures above.
- **Aging** (`listInvoices`'s existing balance/status logic) already works
  per-invoice regardless of whether it is visit- or admission-scoped - no
  change needed, confirmed by re-reading `listInvoices`.

## 11. Roles and permissions

| Action | Roles | Note |
|---|---|---|
| `admission:create` / `edit` / `transfer` / `discharge` | *(existing, unchanged)* | NURSE/DOCTOR/HOSPITAL_ADMIN combinations already in `permissions.ts` |
| `admission:deposit` (new) | RECEPTIONIST, ACCOUNTANT, HOSPITAL_ADMIN | money handling, mirrors `billing:manage`'s role set |
| `admission:deposit-refund` (new) | ACCOUNTANT, HOSPITAL_ADMIN | deliberately narrower than `admission:deposit` - separation of duties |
| `admission:discharge-unsettled` (new) | HOSPITAL_ADMIN | override with mandatory reason, audited |
| `admission:reopen` (new) | attending doctor on the admission, or HOSPITAL_ADMIN | mirrors `visit:reopen`; reason required, audited |
| Ward `dailyRate`/`dayCaseRate` edit | `admin:settings` *(existing)* | same gate as the rest of hospital admin settings |
| `inpatientChargeRule` / `shortStayChargeMode` / toggles | `admin:settings` *(existing)* | Settings screen |
| Claim generation for an admission | `claims:manage` *(existing)* | same gate, new code path |

Both `apps/api/src/common/permissions.ts` and `apps/web/lib/permissions.ts`
need the five new actions (`permissions.drift.spec.ts` enforces they stay
in sync).

## 12. Edge cases

- **Admitting into a ward with no `dailyRate` set** → blocked at admission
  time (section 6), not discovered as a billing gap days later.
- **A ward with `DAY_CASE_RATE` selected hospital-wide but no `dayCaseRate`
  set on this particular ward** → the short-stay charge is blocked with a
  clear message naming the ward (section 6), not silently charged at the
  full `dailyRate`.
- **Transfer on the same day as admission or discharge** → the ward-stay
  history (section 6) means the nightly/discharge reconciliation correctly
  attributes a night to whichever ward was open at the census point, even
  if there were three transfers that day; never more than one charge for
  that night.
- **Patient dies or absconds** (`DECEASED`/`ABSCONDED` status) → same
  discharge path, same final-night reconciliation; `requireSettledBillAtDischarge`
  still applies unless overridden (a hospital may reasonably choose to turn
  this setting off entirely rather than override every such case - that is
  exactly why it is a toggle).
- **Patient re-admitted the same day as a prior discharge** → a brand new
  `Admission` row and a brand new running-bill invoice; no reuse of the
  closed one, matching how `admit()` already rejects a second `ADMITTED`
  row per patient but does not prevent sequential admissions.
- **Deposit refund exceeds remaining refundable amount** → rejected
  (`BadRequestException`), computed server-side from `amount - refundedAmount`,
  never trusting a client-supplied "remaining" figure.
- **Claim generation attempted before discharge** → blocked with a clear
  message ("the admission must be discharged before its claim can be
  raised") - the bill is not final until then.
- **Ward rate changed mid-stay** → never touches nights already posted as
  frozen `InvoiceLine`s; only affects nights charged from that point on.
- **A supplementary invoice spawns mid-stay** (an interim cash payment
  locks the primary running-bill invoice) → the nightly job's
  `resolveOpenInvoiceForAdmission` call lands the next night's charge on the
  open supplementary invoice automatically, exactly like the outpatient
  FUNC-2 path; the claim-generation path already accounts for this
  (section 7 gathers every invoice for the admission, not just one).
- **A clinical entry is needed after discharge** (a late result, a note
  correction) → `admission:reopen` (section 4) lifts the clinical guard
  without reverting `AdmissionStatus` or re-occupying a bed; a resulting
  late charge opens a new supplementary invoice since the discharge-time
  invoices are already locked.

## 13. Tests to write

- Unit: `InpatientChargeRule`/`shortStayChargeMode` day-counting for the
  exact boundary example in the brief (admit 23:00, discharge 08:00 next
  day → 1 night) under both `MIDNIGHT_CENSUS` and `ROLLING_24H`, plus all
  three `shortStayChargeMode` values on a same-calendar-day stay under both
  rules (section 6's worked table, in full). Same spirit as
  `lagos-time.spec.ts`'s boundary tests.
- Integration (`admissions.int-spec.ts`, new): admit → deposit (receipt
  issued) → nightly cron posts one bed-day line at the correct ward rate →
  transfer mid-stay → nightly job attributes the post-transfer night to the
  new ward, at the new ward's rate, with no duplicate line for the transfer
  day → a service charge (lab order) during the stay posts to the
  admission's invoice, not a visit's → interim bill reflects running
  totals correctly → discharge reconciles the final partial night → final
  bill totals match hand-computed expectation.
- Integration: deposits and their refunds appear in `ReportsService.payments()`
  /`paymentsCsv()` tagged `DEPOSIT`/`DEPOSIT_REFUND`, alongside ordinary
  `Payment` rows, within the correct date range; `overview()`'s revenue KPIs
  are unaffected by an unapplied deposit and only change once `apply-deposit`
  posts a real `Payment`; the new "Deposits held" KPI reflects open
  admissions' unapplied credit only.
- Integration: `admission:deposit-refund` is required and distinct from
  `admission:deposit` - a RECEPTIONIST can take a deposit but is rejected by
  `assertCan` attempting a refund.
- Integration: `requireSettledBillAtDischarge` on, unpaid balance blocks
  discharge; HOSPITAL_ADMIN override with reason succeeds and is audited;
  non-admin override attempt is rejected by `assertCan`.
- Integration: an interim payment mid-stay locks the primary invoice; the
  next charge lands on a new supplementary invoice (reuse of the FUNC-2
  test pattern from `billing.int-spec.ts`'s `describe('FUNC-2: ...')` block).
- Integration: `admission:reopen` after discharge lifts the clinical guard
  without changing `AdmissionStatus`; a late charge after reopen lands on a
  new supplementary invoice since the discharge-time invoices are locked.
- Integration: claim generation for a discharged HMO admission with two
  invoices (primary + one supplementary) produces exactly one
  `InsuranceClaim` whose lines are drawn from both; generation before
  discharge is rejected; generation without an `authCode` is rejected.
- Integration: the section 7 backfill-verification queries return zero rows
  against the seeded/test database, run as a standing CI check, not a
  one-off; remittance against a two-invoice admission claim posts the
  correct `Payment` amount to each underlying invoice (not just the
  primary) and recomputes both; a full outpatient
  generate→batch→CSV→remittance→write-off→aging sequence produces identical
  results before and after the generalisation (section 7's regression).
- Integration: an `apply-deposit` call never creates a `Payment` larger
  than the amount actually owed, even when more deposit is available -
  the overpayment-by-construction invariant from section 5.
- Integration: deposit refund cannot exceed the deposit's own remaining
  balance; discharge with a negative balance requires a recorded refund
  before it completes.
- Web: a smoke pass on the inpatient workspace, admissions-bill drawer, and
  print views (manual, per the usability test plan's new F1 cases - admit
  through discharge and HMO claim, see `phase1-status.md`'s updated
  definition of done).

## 14. Effort estimate

| Piece | Size |
|---|---|
| Schema migrations (Invoice/Admission/Ward additions, 5 clinical models' `admissionId`, `AdmissionDeposit`, `AdmissionWardStay`, `BedDayCharge`, `InsuranceClaim.admissionId`, Tenant settings) | M |
| `resolveOpenInvoiceForAdmission` + `postCharge` dispatcher + `resolveBillingTarget` wiring into pharmacy/encounters | M |
| Inpatient clinical workspace (screen + modals reused with `admissionId`) + admission-reopen flow | M |
| Deposits API + receipts + refund (separate permission) + cash-ledger/report integration | M |
| Ward-stay history + nightly cron + discharge reconciliation + short-stay rule (the trickiest correctness piece) | L |
| Claims multi-invoice-per-admission generation, including the backfill-verification pass and generalising remittance/write-off posting off a single `claim.invoiceId` (section 7) | M |
| Discharge settlement gate + override + automatic deposit application + refund-at-discharge | S |
| Discharge summary assembly + print | S |
| Interim/final bill read + print | S |
| Reports additions (census, inpatient revenue, deposits held) | S |
| Web: admit/transfer/discharge screens updated for deposits/bill/rates, Wards admin rate fields, Settings toggles | L |
| Tests (section 13) | M |

**Overall: Large** - this is the biggest of the three F-items, mainly
because of the day-counting/transfer-history correctness work and because
it touches charge-posting call sites outside the admissions module itself
(pharmacy, encounters). Build order approved as sub-steps F1a → F1b → F1c →
F1d (see `phase1-status.md`), each independently testable before the next
depends on it.
