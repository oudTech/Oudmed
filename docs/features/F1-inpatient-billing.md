# F1: Inpatient / Admissions Billing

Status: design, not yet built. Scope-change item (2026-10-01) - promoted from
backlog to a Phase 1 launch blocker. See `docs/audit/pricing-notes.md` for
the original gap analysis this design is built on, and
`docs/audit/phase1-status.md` for where this sits in the plan.

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
  the claim's own `invoiceId`. This turns out to matter for section 6.
- **No cron infrastructure needed from scratch** - `@nestjs/schedule` is
  already a dependency and already used
  (`apps/api/src/subscriptions/renewal.service.ts`, three daily `@Cron`
  jobs iterating every active tenant via `PrismaService.forTenant`). The
  bed-day charge job below follows that exact pattern.
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
- **Every charge-creation path during a stay must route to the admission,
  not a visit**, once a patient is admitted: pharmacy dispense, clinical
  orders (labs/imaging/procedures), and any consultation/service charge.
  New helper `resolveBillingTarget(tx, patientId)`: if the patient has an
  `ADMITTED` admission, return `{ admissionId }`; otherwise fall back to
  whatever `visitId` the caller already had. Called once at the top of
  `pharmacy.dispense()` and `encounters.createOrder()`/consultation-charge
  sites, replacing their direct `visitId` passthrough.

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
migration needed (existing rows stay visit-only). The encounter workspace
and ward-round UI pass `admissionId` instead of/alongside `visitId` when the
patient is currently admitted.

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

## 4. Deposits

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
  `Invoice`/`Payment`. Permission `admission:deposit` (new action:
  ACCOUNTANT, RECEPTIONIST, HOSPITAL_ADMIN - the billing-desk roles, not
  clinical ones, matching `billing:manage`'s own role set since this is
  money handling).
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
  around.
- `POST /admissions/:id/deposits/:depositId/refund` `{ amount, reason }` -
  partial or full refund of one deposit; blocked if `amount` exceeds
  `deposit.amount - (deposit.refundedAmount ?? 0)`. Audited
  (`DEPOSIT_REFUND`, before/after, same shape as the item 9 line-edit audit).
- `GET /admissions/:id/bill` (section 8) includes `totalDeposited`
  (sum of `amount - refundedAmount` across deposits - i.e. credit not yet
  applied as a Payment and not yet refunded) alongside the invoice-derived
  totals.

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
(section 8) and the discharge settlement gate (section 7).

### Refunds never require reversing a Payment, by construction

The settlement actions above are deliberately written to convert **at most**
`min(availableDeposit, amountOwed)` into a real `Payment` - never more. Any
deposit beyond what was actually owed stays as `AdmissionDeposit` credit and
is refunded directly through the deposit-refund endpoint above, with no
`Payment` ever created for the excess and therefore nothing to reverse. An
overpayment-via-deposit-application should not be able to happen if this
rule is followed consistently in both `apply-deposit` and the discharge
settlement step (section 7); it is called out explicitly here as an
implementation invariant to test for (section 12), not merely a hope.

## 5. Bed/ward charges

### Rate source

```prisma
model Ward {
  // ...existing fields...
  dailyRate Decimal? @db.Decimal(12, 2)
}
```

One mutable rate per ward, admin-editable from the existing Wards admin
screen (no history table needed for v1: changing a rate only affects
*future* nights, since a night already charged is a frozen `InvoiceLine`
with its own `unitPrice` - changing `Ward.dailyRate` tomorrow cannot alter
an invoice line already posted today). `dailyRate` is `null` until an admin
sets it; an admission cannot be opened against a ward with no rate set
(`BadRequestException`, clear message naming the ward) - this is a
deliberate hard stop so "forgot to price a ward" fails loudly at admission
time, not silently at the first missed night.

### Charging rule (per-hospital, configurable, defined precisely)

```prisma
enum InpatientChargeRule {
  MIDNIGHT_CENSUS
  ROLLING_24H
}

model Tenant {
  // ...existing fields...
  inpatientChargeRule         InpatientChargeRule @default(MIDNIGHT_CENSUS)
  inpatientMinimumOneDayCharge Boolean            @default(true)
  requireSettledBillAtDischarge Boolean           @default(false)
}
```

Editable from Settings (`SettingsService`/`HospitalSettingsDTO`, same
pattern as `invoicePrefix` etc.) - a dropdown + two toggles.

- **`MIDNIGHT_CENSUS`** (default - the standard hospital convention): one
  bed-day is charged for every Lagos midnight (`lagosCalendarDate` /
  `startOfDayLagos` from `common/lagos-time.ts`, the same helper Batch A
  built) at which the patient is still an open `Admission` occupying a bed.
  The ward charged for that night is whichever `AdmissionWardStay` (below)
  was open at the midnight instant itself.
- **`ROLLING_24H`**: one bed-day per full-or-partial 24-hour block measured
  from the exact `admittedAt` timestamp, independent of calendar midnight.
  The ward charged for a block is whichever `AdmissionWardStay` was open at
  **the instant that block ends** - the same "which stay was open at this
  one instant" rule `MIDNIGHT_CENSUS` uses, just evaluated at a different
  instant, rather than a separate majority-of-the-block calculation. This
  keeps both rules sharing one mechanism and avoids the need to apportion a
  single block across two wards.
- **`inpatientMinimumOneDayCharge`**: when true (default), a same-day
  admission-and-discharge that crosses zero midnights still charges one
  night (common policy - a bed was occupied regardless of the clock). When
  false, a same-day stay charges nothing. This toggle **only affects
  `MIDNIGHT_CENSUS`** - `ROLLING_24H` always charges at least one block for
  any admission by construction (there is always at least one partial
  24-hour block from `admittedAt`), so the toggle has nothing to do there.

### Worked examples, both rules, per the brief

| Scenario | `MIDNIGHT_CENSUS` | `ROLLING_24H` |
|---|---|---|
| Admitted 23:00, discharged 08:00 next day | 1 Lagos midnight falls inside the stay → **1 night** | 9 hours elapsed, one partial 24h block → **1 day** |
| Admitted 09:00, discharged 17:00 same day | 0 midnights crossed → **0 nights** with the minimum-charge toggle off, **1 night** with it on (default) | 8 hours elapsed, one partial 24h block → **1 day** (always ≥ 1, the toggle does not apply) |
| Admitted Day 1 10:00 (Ward A), transferred Day 1 15:00 to Ward B, discharged Day 2 10:00 | 1 midnight crossed, patient in Ward B at that instant → **1 night, Ward B's rate** (Ward A is never charged - no midnight occurred while the stay was open there) | 1 full 24h block (10:00→10:00); the block *ends* in Ward B → **1 day, Ward B's rate** |

The middle row is the case where the two rules - and the minimum-charge
toggle - genuinely diverge, and is exactly why both are exposed as
independent settings rather than one combined choice. The bottom row shows
why `MIDNIGHT_CENSUS` has no transfer-attribution ambiguity to resolve in
the first place (a transfer before the only midnight in the stay means Ward
A simply never had an open stay at any census point), while `ROLLING_24H`
needs the explicit "ward at block end" rule stated above to get a
well-defined answer at all.

**Confirmed: this is a per-hospital setting**, not a fixed system rule -
`Tenant.inpatientChargeRule` (enum column, default `MIDNIGHT_CENSUS`) and
`Tenant.inpatientMinimumOneDayCharge` (boolean, default `true`), both
editable from Settings alongside every other per-tenant toggle.

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

A new daily job, following `renewal.service.ts`'s exact pattern:

```ts
@Cron('5 23 * * *') // 23:05 UTC = 00:05 Africa/Lagos, just after midnight census
async postNightlyBedCharges() { /* iterate active tenants via forTenant, same as RenewalService */ }
```

For each `ADMITTED` admission in each tenant: determine whether last
night's census point has already been charged (idempotency: check whether
an `InvoiceLine` already exists for this admission dated that night -
practically, store `nightOf: DateTime` on the line via `ClinicalOrder`-style
`description`/`providedAt` is enough, or add a small `BedDayCharge
{ admissionId, nightOf, invoiceLineId }` marker table to make idempotency a
trivial unique-constraint check rather than a string/date scrape - **use the
marker table**, it is one small model and removes an entire class of
"did we already charge this night" bugs). Post one `InvoiceLine` at the
ward-at-that-night's `dailyRate` via `postCharge` (category `"Inpatient"`,
description `"Ward stay - <ward name> - <date>"`).

At **discharge**, before closing the admission: run the same per-night
reconciliation for any night from the last cron run up to the discharge
instant (so a patient discharged at 6am is correctly billed for the night
just passed even though the 00:05 cron has already run and - depending on
exact timing - may or may not have seen this admission). This makes
discharge the authoritative "final settle" step regardless of cron timing.

### Transfers: no double charge for the same day

Guaranteed structurally, not by a special case: at any instant exactly one
`AdmissionWardStay` row is open for an admission, so the nightly job (and
the discharge reconciliation) can only ever attribute one ward to one night.

## 6. HMO inpatients: one claim per episode

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

## 7. Discharge

### Settlement gate

Discharge first runs the final night's reconciliation (section 5), then
**automatically applies available deposit credit** via the same
`apply-deposit` mechanism (section 4), capped at `min(availableDeposit,
amountOwed)` - this is the one place deposit application happens without a
separate staff click, since "settle what's owed from the deposit on hand"
is exactly what discharge is supposed to do. Only the balance left *after*
that automatic application is subject to the gate below.

`Tenant.requireSettledBillAtDischarge` (section 5) - default **off**, so
F1 never blocks a clinical discharge by default (a hospital should not be
forced to choose this feature to keep discharging patients the way they do
today). When on: `discharge()` is blocked if the post-deposit-application
balance (section 4) is greater than zero, with a clear message naming the
amount owed. **Override**: a Hospital Admin can discharge anyway with
`admission:discharge-unsettled` (new permission, HOSPITAL_ADMIN only) +
a required reason, audited (`DISCHARGE_UNSETTLED_OVERRIDE`, metadata:
balance, reason) - the same override-with-reason shape used throughout this
codebase (FUNC-1 off-formulary, item 9 line edits).

### Deposit refund at discharge

If, after automatic application, deposit credit remains (the bill came in
lower than what was deposited), discharge requires recording the refund
(method + reference) before it completes - same inline reason/amount flow
as the deposit-refund endpoint (section 4), surfaced as a mandatory step in
the discharge screen rather than something staff have to remember to do
separately afterward. Because application is always capped at what was
actually owed (section 4), this refund is always a plain
`AdmissionDeposit` refund, never a `Payment` reversal.

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

## 8. Interim bills

`GET /admissions/:id/bill` - admission info, ward/bed history, deposits
(with refund status), every invoice for this `admissionId` (primary +
supplementary, each with its own lock state exactly as the billing drawer
already computes it), running totals (charged, deposited, balance).
Printable at any time during the stay via the same A4 print component used
for the final bill/discharge summary, labelled "Interim bill - stay in
progress" vs. "Final bill" so a mid-stay printout is never mistaken for the
closing statement.

## 9. Reports

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
- **Aging** (`listInvoices`'s existing balance/status logic) already works
  per-invoice regardless of whether it is visit- or admission-scoped - no
  change needed, confirmed by re-reading `listInvoices`.

## 10. Roles and permissions

| Action | Roles | Note |
|---|---|---|
| `admission:create` / `edit` / `transfer` / `discharge` | *(existing, unchanged)* | NURSE/DOCTOR/HOSPITAL_ADMIN combinations already in `permissions.ts` |
| `admission:deposit` (new) | RECEPTIONIST, ACCOUNTANT, HOSPITAL_ADMIN | money handling, mirrors `billing:manage`'s role set |
| `admission:discharge-unsettled` (new) | HOSPITAL_ADMIN | override with mandatory reason, audited |
| Ward `dailyRate` edit | `admin:settings` *(existing)* | same gate as the rest of hospital admin settings |
| `inpatientChargeRule` / toggles | `admin:settings` *(existing)* | Settings screen |
| Claim generation for an admission | `claims:manage` *(existing)* | same gate, new code path |

Both `apps/api/src/common/permissions.ts` and `apps/web/lib/permissions.ts`
need the two new actions (`permissions.drift.spec.ts` enforces they stay in
sync).

## 11. Edge cases

- **Admitting into a ward with no `dailyRate` set** → blocked at admission
  time (section 5), not discovered as a billing gap days later.
- **Transfer on the same day as admission or discharge** → the ward-stay
  history (section 5) means the nightly/discharge reconciliation correctly
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
  (section 6 gathers every invoice for the admission, not just one).

## 12. Tests to write

- Unit: `InpatientChargeRule` day-counting for the exact boundary example in
  the brief (admit 23:00, discharge 08:00 next day → 1 night) under both
  `MIDNIGHT_CENSUS` and `ROLLING_24H`, plus the `inpatientMinimumOneDayCharge`
  toggle on a same-calendar-day stay.
  Same spirit as `lagos-time.spec.ts`'s boundary tests.
- Integration (`admissions.int-spec.ts`, new): admit → deposit → nightly
  cron posts one bed-day line at the correct ward rate → transfer mid-stay
  → nightly job attributes the post-transfer night to the new ward, at the
  new ward's rate, with no duplicate line for the transfer day → a service
  charge (lab order) during the stay posts to the admission's invoice, not
  a visit's → interim bill reflects running totals correctly → discharge
  reconciles the final partial night → final bill totals match
  hand-computed expectation.
- Integration: `requireSettledBillAtDischarge` on, unpaid balance blocks
  discharge; HOSPITAL_ADMIN override with reason succeeds and is audited;
  non-admin override attempt is rejected by `assertCan`.
- Integration: an interim payment mid-stay locks the primary invoice; the
  next charge lands on a new supplementary invoice (reuse of the FUNC-2
  test pattern from `billing.int-spec.ts`'s `describe('FUNC-2: ...')` block).
- Integration: claim generation for a discharged HMO admission with two
  invoices (primary + one supplementary) produces exactly one
  `InsuranceClaim` whose lines are drawn from both; generation before
  discharge is rejected; generation without an `authCode` is rejected.
- Integration: remittance against a two-invoice admission claim posts the
  correct `Payment` amount to each underlying invoice (not just the
  primary) and recomputes both; an outpatient (single-invoice) claim's
  remittance posts identically to its current behaviour, confirmed with a
  before/after comparison against an existing `billing.int-spec.ts`-style
  outpatient remittance test.
- Integration: an `apply-deposit` call never creates a `Payment` larger
  than the amount actually owed, even when more deposit is available -
  the overpayment-by-construction invariant from section 4.
- Integration: deposit refund cannot exceed the deposit's own remaining
  balance; discharge with a negative balance requires a recorded refund
  before it completes.
- Web: a smoke pass on the new admissions-bill drawer/print views (manual,
  per the usability test plan's new F1 cases - admit through discharge and
  HMO claim, see `phase1-status.md`'s updated definition of done).

## 13. Effort estimate

| Piece | Size |
|---|---|
| Schema migrations (Invoice/Admission/Ward additions, 5 clinical models' `admissionId`, `AdmissionDeposit`, `AdmissionWardStay`, `InsuranceClaim.admissionId`, Tenant settings) | M |
| `resolveOpenInvoiceForAdmission` + `postCharge` dispatcher + `resolveBillingTarget` wiring into pharmacy/encounters | M |
| Deposits API + refund | S |
| Ward-stay history + nightly cron + discharge reconciliation (the trickiest correctness piece) | L |
| Claims multi-invoice-per-admission generation, including generalising remittance/write-off posting off a single `claim.invoiceId` (section 6's table) | M |
| Discharge settlement gate + override + refund-at-discharge | S |
| Discharge summary assembly + print | S |
| Interim/final bill read + print | S |
| Reports additions (census, inpatient revenue) | S |
| Web: admit/transfer/discharge screens updated for deposits/bill/rates, Wards admin rate field, Settings toggles | L |
| Tests (section 12) | M |

**Overall: Large** - this is the biggest of the three F-items, mainly
because of the day-counting/transfer-history correctness work and because
it touches charge-posting call sites outside the admissions module itself
(pharmacy, encounters). Recommend building in the sub-order listed above
(schema → charge routing → deposits → bed-day charging → discharge →
claims → reports → web), since each piece is independently testable before
the next depends on it.
