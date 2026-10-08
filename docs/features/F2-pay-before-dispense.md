# F2: Per-hospital setting - require payment before dispensing

Status: design, not yet built. Scope-change item (2026-10-01) - promoted from
backlog to a Phase 1 launch blocker.

## 1. What exists today

Confirmed by re-reading `PharmacyService.dispense()` and
`resolveDispensePrice()` (`apps/api/src/pharmacy/pharmacy.service.ts:79-260`,
most of it already touched this session for the FUNC-1 price-integrity and
expiry-message work):

- `dispense()` does **stock draw-down and charge-posting in one atomic
  step**, keyed off each `PrescriptionItem.dispensedQty`. There is no
  concept of "charged but not yet released" anywhere - `dispensedQty` means
  fully dispensed, stock already decremented, full stop.
- Price resolution (`resolveDispensePrice`) is already catalogue-authoritative
  with an audited override path (FUNC-1) - this is reused unchanged by F2;
  nothing about *what* is charged changes, only *when* stock moves relative
  to payment.
- `Payment` is recorded **per invoice**, not per line - `RecordPaymentModal`
  pays against an invoice's `balanceDue` as a whole. There is no per-line
  "this specific charge is paid" flag anywhere in the schema. This is a real
  constraint the design below has to work within (section 4).
- Co-pay already has a resolution path: `InsuranceProvider.defaultCoPayPct`
  (`schema.prisma:643`), used today only by `ClaimsService.generate()`
  (`claims.service.ts:392-413`) to split a claimed invoice line into the
  HMO-claimed amount and the implied patient co-pay via
  `factor = 1 - coPayPct/100`. F2 reuses this exact resolution (provider via
  `visit.insuranceProviderId` / `visit.patient.insuranceProviderId`, or a
  name-match fallback on `hmoName`), just earlier in the flow (at dispense
  time, not at claim time).
- The dispensing queue (`DispensingQueue.tsx`) shows `dispenseStatus`
  (PENDING/PARTIAL/DISPENSED/CANCELLED per
  `packages/contracts/src/patient.ts:247`) with no intermediate
  "charged, waiting on payment" state.
- `Tenant` already holds per-hospital boolean/scalar settings directly as
  columns (`invoicePrefix`, `documentFooter`, etc.) - the pattern F2's
  setting follows.

**Confirmed while investigating FUNC-2's item 1** (recorded in
`docs/audit/backlog.md` before this scope change): "nothing gates dispensing
on payment status today" - this document is that gap closed.

## 2. The setting

```prisma
model Tenant {
  // ...existing fields...
  requirePaymentBeforeDispense Boolean @default(false)
}
```

Default **off** - today's behaviour (dispense immediately, charge posted
atomically with stock draw) is unchanged for any hospital that doesn't turn
this on. Editable from Settings, same pattern as every other `Tenant`
scalar (`SettingsService`/`HospitalSettingsDTO`).

## 3. Schema: a "prepared, not yet released" state

Dispensing is tracked per `PrescriptionItem` today (`dispensedQty`,
`dispenseUnitPrice`) - the gated state needs the same granularity, since one
prescription can have one item exempt (HMO-covered, dispensed immediately)
and another gated (co-pay, awaiting payment) at the same time (section 6).

```prisma
model PrescriptionItem {
  // ...existing fields...
  preparedQty           Int      @default(0)
  preparedUnitPrice     Decimal? @db.Decimal(12, 2)
  preparedInvoiceLineId String?
  preparedAt            DateTime?
  preparedById          String?
}
```

`DispenseStatus` (currently `PENDING | PARTIAL | DISPENSED | CANCELLED`,
`packages/contracts/src/patient.ts:247`) gains `AWAITING_PAYMENT` - computed
the same way `PARTIAL`/`DISPENSED` already are today (derived from the set
of items' states, not stored redundantly): a prescription is
`AWAITING_PAYMENT` if it has at least one item with `preparedQty > 0` and no
item is still fully pending with nothing prepared or dispensed.

## 4. The two-phase flow

### Prepare (`POST /pharmacy/prescriptions/:id/prepare`)

Same price resolution as today's `dispense()` (`resolveDispensePrice`,
catalogue-authoritative, override needs `billing:manage` + reason) and the
same per-item delta semantics (only the increase over
`dispensedQty + preparedQty` is newly prepared). The differences:

- **No stock is drawn.** `drawStockFefo` is not called.
- The charge **is** posted, via the same `postCharge` dispatcher F1
  introduces (visit or admission, whichever applies) - this is deliberate:
  "prepares the prescription, which posts the charge" is explicit in the
  brief. The created `InvoiceLine`'s id is recorded as
  `preparedInvoiceLineId` on the item, so it can be identified and reversed
  later without guessing which line belongs to which preparation.
- `PrescriptionItem.preparedQty`/`preparedUnitPrice`/`preparedAt`/
  `preparedById` are set; `dispensedQty` is untouched.
- Prescription `dispenseStatus` moves to `AWAITING_PAYMENT`.
- Audited (`PREPARE_DISPENSE`, metadata: item, quantity, price, invoice
  line id).

### Patient pays at billing

Unchanged - `POST /billing/invoices/:id/payments`, against the invoice that
now carries the prepared line(s) alongside whatever else is on it.

**Constraint, stated plainly rather than hidden**: because this app has no
per-line payment tracking (section 1), "has this charge been paid" is
answered at the *invoice* level - but **only for the PATIENT's own
payable share of it, not the invoice's full total.** Changed 2026-10-09
(`patientPayableAmount()`, section 12): the gate used to require the whole
invoice `PAID`, which for an HMO patient meant also waiting on the HMO's
own share - money that only arrives weeks later via claim remittance, by
which point a patient who had already paid their own co-pay in full
should long since have had their drugs. The gate now compares total
payments against `invoice.totalAmount * coPayPct / 100` (the same
resolver `ClaimsService.generate()` uses), which for a cash patient
(coPayPct resolves to 100%) is still the whole invoice, unchanged - the
fix is specific to HMO co-pay patients.

**What is still a real constraint, correctly scoped now**: a patient must
clear *their own* full payable share on that invoice - including an
unrelated consultation co-pay on the same visit, not just this drug's own
co-pay - before any item on it releases, since payments aren't tracked
per line. A future per-line reservation/payment model would relax this
further, but is out of scope here. In practice this rarely bites: a
prepared pharmacy charge usually shares an invoice with that same visit's
consultation/lab charges, settled together at the same billing-desk
visit - but it is real when it does not, and both the doc and the UI say
so exactly:

- **"Awaiting payment" status copy** (section 6): *"Awaiting patient
  payment - the patient's own payable share (co-pay plus any uncovered
  charges on the same invoice) must be cleared before these items can be
  released. An HMO's own share, settled later by claim, is never part of
  this wait."*
- **Release-blocked reason** (if release is attempted before the
  patient's share clears): *"Awaiting patient payment (balance: ₦X)"* -
  X is the patient's own remaining balance, never the HMO's.

### Alternative considered: a dedicated pharmacy-only invoice

Still relevant after the 2026-10-09 patient-payable fix above - that fix
removed the HMO-share part of this friction (a co-pay patient no longer
waits on remittance), not the "other uncovered charges on the same
invoice" part. A drugs-only invoice, kept separate from that visit's
consultation/lab invoice, would remove the remaining friction entirely - a
patient could pay for just their drugs without needing to clear an
unrelated charge. It is a real, boundedly-sized alternative, not dismissed
here as impractical:

- **What it would take**: `prepare()` would resolve a *second*,
  category-scoped open invoice for the visit (a new
  `resolveOpenPharmacyInvoiceForVisit`, filtering by `category: 'Pharmacy'`
  instead of taking whichever invoice is open) instead of sharing the
  visit's one open invoice. It would need its own supplementary-invoice
  handling (a drugs-only bill can itself become locked and need a
  supplementary one, same FUNC-2 mechanism, just scoped) - not new
  machinery, but a second parallel instance of it.
- **What it would cost**: every visit with a gated pharmacy charge now has
  **two** open invoices instead of one, which ripples outward - the billing
  list and reports would show two invoice rows per such visit instead of
  one, and billing-desk staff would need to see clearly which invoice is
  "the drugs one" vs. "everything else" rather than the one-invoice-per-
  visit mental model FUNC-2 was built around. The code cost is moderate (a
  category-filtered variant of an existing resolver); the UX/reporting cost
  is the real one, and is not free.
- **Decision (approved): keep the single shared-invoice design for F2's
  build**, with the UI copy above making the constraint explicit rather than
  surprising anyone. A dedicated pharmacy-only invoice is logged in
  `docs/audit/backlog.md` as a follow-up enhancement to revisit if this
  friction proves real in practice once a hospital is actually using the
  gate day to day - a contained, well-understood addition to layer in
  later, not something that blocked F2 from shipping.

### Release (`POST /pharmacy/prescriptions/:id/release`)

For each item with `preparedQty > 0`: re-fetch `preparedInvoiceLineId`'s
parent invoice (never trust a cached "paid" flag from the queue) and
confirm total payments on it cover `patientPayableAmount()` - the
patient's own share, not the invoice's full total (section 12). If so:
draw stock via the existing `drawStockFefo` (same FEFO/expiry-cutoff
logic, unchanged) for `preparedQty`, set `dispensedQty += preparedQty`,
`dispenseUnitPrice = preparedUnitPrice`, clear the `prepared*` fields, and
mark the item physically handed over. If the patient's share is not yet
covered, the item is left untouched and reported back as still awaiting
payment - release is all-or-nothing per item, never a partial stock draw
for a partially resolved invoice. Audited (`RELEASE_DISPENSE`).

### If the patient never pays: cancel the preparation

`POST /pharmacy/prescriptions/:id/items/:itemId/cancel-preparation`
`{ reason }`. This is not a new mechanism - the prepared charge is an
ordinary, still-unlocked `InvoiceLine` (no payment has landed on it, so
`isLocked` is false), so cancelling it **reuses `removeInvoiceLine` as-is**,
including item 9's own rule that a removal always needs a reason and is
always audited. After the line is voided: `preparedQty`/`preparedUnitPrice`/
`preparedInvoiceLineId`/`preparedAt`/`preparedById` are reset to
zero/null, and `dispenseStatus` reverts to whatever the item's remaining
state implies (`PENDING` if nothing else on the prescription is
dispensed/prepared, `PARTIAL` if some other item already went through
exempt/immediate dispensing). **Stock was never touched during prepare, so
there is nothing to reverse there** - this is precisely why the gate exists
before the stock draw, not after.

## 5. Exemptions

All three skip the prepare/await/release dance entirely and fall straight
through to today's existing immediate dispense+charge+stock-draw, in one
step, exactly as it works with the setting off.

### HMO-covered portion

Resolved through the shared `resolveInsuranceProvider()` (originally
`ClaimsService.generate()`'s co-pay logic, factored out into
`src/common/insurance-provider-resolver.ts` during the 2026-10-08 HMO-
claims investigation - see `docs/audit/phase1-status.md`): given the
visit's (or patient's) linked `InsuranceProvider`, read `defaultCoPayPct`.

- **`coPayPct` is 0 or unset** → the entire line is HMO-covered → exempt,
  dispensed immediately, no gate at all.
- **`coPayPct` is any value above 0** → the WHOLE item is held - full
  quantity, full charge, one `InvoiceLine` at the item's real price - until
  the carrying invoice is paid, then the full quantity releases at once.
  **Changed 2026-10-08** from an earlier design that split both the charge
  and the quantity proportionally into an immediately-dispensed covered
  share and a gated co-pay share: in practice a patient watching only part
  of their prescription come out of the bag, with no clear reason why,
  was worse than just holding the whole item - see item 12 for the exact
  mechanics and why this does not affect claim amounts. **An unconfigured
  provider is not meant to be the same as a genuine 0% co-pay, even though
  it resolves the same way today** (`defaultCoPayPct` left blank reads as
  0, per `insurance-provider-resolver.ts` - see
  `docs/audit/phase1-status.md`'s co-pay-field finding): the item dispenses
  immediately, fully exempt, same as a real 0%-co-pay provider, silently
  billing the insurer for the whole amount. Set every provider's co-pay
  before go-live - see `docs/DEPLOYMENT.md` section 5.

### Inpatient, billed to the admission's running bill (depends on F1)

If `resolveBillingTarget` (F1, section 2) resolves the dispensing patient to
a currently `ADMITTED` admission, the gate is skipped unconditionally,
regardless of the tenant setting. Rationale stated plainly: an admission's
running bill is reconciled and settled in aggregate at discharge (F1,
section 7), not charge-by-charge during the stay - gating a single drug on
immediate payment does not fit that model and would block routine inpatient
care for a bill that is never supposed to be paid piecemeal.

### Emergency override

New permission `pharmacy:dispense-emergency-override` (PHARMACIST,
HOSPITAL_ADMIN). Passed as `{ emergencyOverride: true, overrideReason:
string }` on the **existing** `dispense()` call (not prepare) - this is
deliberately the one path that still dispenses in the old one-step way, on
purpose, for a genuine emergency where stopping to collect payment first is
not acceptable. Requires `overrideReason` (rejected without one, same
pattern as every other reason-gated action in this codebase); audited
(`EMERGENCY_DISPENSE_OVERRIDE`, metadata: item, quantity, price, reason) and
surfaced in the same admin-facing manual-overrides report item 9 built
(`GET /billing/line-edits-report` conceptually extends to - or a sibling
`GET /pharmacy/dispense-overrides-report` mirroring it; see section 9).

## 6. Dispensing queue UI

`DispensingQueue.tsx` and the prescriptions list already group by item. Per
item, the status pill gains two new states on top of the existing ones:

- **"Awaiting patient payment: ₦X"** - `preparedQty > 0`, the patient's own
  payable share (`patientPayableAmount()`, section 12) not yet covered. X
  is that specific outstanding balance, never the HMO's. Shown with the
  exact copy from section 4 the first time a patient sees it: *"Awaiting
  patient payment - the patient's own payable share (co-pay plus any
  uncovered charges on the same invoice) must be cleared before these
  items can be released. An HMO's own share, settled later by claim, is
  never part of this wait."*
- **"Paid - ready to dispense"** - `preparedQty > 0`, the patient's payable
  share is covered. Computed live by joining to the invoice on read, never
  cached, so a payment reversal (item 9's existing `reversePayment`) is
  immediately reflected back to "Awaiting patient payment" with no
  separate reconciliation step.

A "Release" button appears only in the second state; a "Cancel
preparation" (with the mandatory reason field, same inline pattern as item
9's remove-line confirm) appears in both gated states.

## 7. Co-pay and supplementary invoices together

Two things that already exist compose cleanly here, by design rather than
by accident:

- **Co-pay** (section 5) either dispenses an item exempt and immediate (0%
  co-pay) or holds the whole item gated (any co-pay above 0) - either way
  it is one `postCharge` call against the visit's currently-open invoice,
  same as any other charge.
- **Supplementary invoices** (FUNC-2): if the invoice carrying an earlier
  preparation becomes locked before this item is released (a payment or
  claim lands on it for unrelated reasons), the *next* preparation for that
  visit lands on a new supplementary invoice automatically -
  `resolveOpenInvoiceForVisit`/`resolveOpenInvoiceForAdmission` handles this
  exactly as it already does for ordinary charges. Because each item stores
  its own `preparedInvoiceLineId`, release always checks the *specific*
  invoice that specific preparation actually landed on - never "the"
  invoice for the visit - so a prescription with items spread across a
  primary and a supplementary invoice releases each item independently and
  correctly as each invoice is settled.

## 8. Roles and permissions

| Action | Roles |
|---|---|
| `prescription:dispense` *(existing)* | unchanged - gates prepare/release/cancel-preparation the same way it gates today's `dispense` |
| `pharmacy:dispense-emergency-override` (new) | PHARMACIST, HOSPITAL_ADMIN |
| `requirePaymentBeforeDispense` toggle | `admin:settings` *(existing)* |

Both `permissions.ts` and `apps/web/lib/permissions.ts` need the new action.

## 9. Edge cases

- **Setting flipped ON mid-stream, with items already prepared under the
  old (off) behaviour** → not possible by construction: when the setting is
  off, `dispense()` never creates a `preparedQty` state at all (it goes
  straight to full dispense), so there is nothing "in flight" to reconcile
  when the setting changes. Flipping it only affects prescriptions prepared
  *after* the change.
  - **Setting flipped OFF while items are genuinely `AWAITING_PAYMENT`**
    → those items stay awaiting payment and must still go through
    `release()` (or `cancel-preparation`) explicitly; turning the setting
    off does not silently auto-release unpaid preparations. This is a
    deliberate safety choice - a toggle in Settings should never cause
    drugs to leave the pharmacy.
- **Partial payment, less than the patient's payable share** → release
  blocked for every item on that invoice (section 4's stated constraint),
  reported clearly with the real outstanding amount rather than silently
  doing nothing. Once total payments reach the patient's share, release
  proceeds even if the invoice as a whole is still `PARTIAL` (the HMO's
  share outstanding) - this is the 2026-10-09 fix's entire point.
- **Two different prescriptions share one invoice, one pays, one doesn't**
  → not possible for *this* constraint to misfire, since release checks are
  per-item against that item's own specific invoice; if both prescriptions'
  prepared lines are on the same invoice, both are gated by the same
  invoice's patient-payable balance (expected, since it is genuinely one
  unsettled bill from the patient's side).
- **Co-pay percentage changes on the provider after a line is already
  prepared** → the already-posted `InvoiceLine`'s amounts are frozen (same
  reasoning as F1's ward-rate changes); only future preparations see the
  new percentage.
- **Emergency override used for a drug that's also out of stock** →
  unaffected by F2; `drawStockFefo`'s existing `OUT_OF_STOCK`/
  `EXPIRED_STOCK_ONLY`/`INSUFFICIENT_STOCK` messages (this session's
  earlier work) still apply at the point stock is actually drawn, which for
  an emergency-override dispense is immediately, same as today.
- **Reversing a payment after release already happened** → does not
  retroactively pull drugs back or reverse stock; `reversePayment` only
  reverses the `Payment` row and re-totals the invoice, as it already does
  today. Once stock has moved, F2 has done its job; any further action
  (chasing an unpaid balance) is a billing-desk matter, not a pharmacy one.

## 10. Tests to write

- Unit/integration: prepare posts a charge with no stock movement
  (`DrugBatch.quantity` unchanged, `Drug.quantityOnHand` unchanged);
  release once the patient's payable share is covered draws stock
  correctly via the existing FEFO/expiry logic; release attempted before
  that share is covered is rejected and makes no stock change.
- Integration (2026-10-09): an HMO patient who pays exactly their own
  co-pay (not the whole invoice) can release - release never waits on the
  HMO's own share; an unrelated uncovered charge on the same invoice still
  blocks release until the patient covers that share too; a cash patient
  still needs the whole invoice paid, unchanged
  (`pharmacy-patient-payable-release.int-spec.ts`).
- Integration: cancel-preparation voids the invoice line (reusing
  `removeInvoiceLine`), requires a reason, is audited, and resets the item
  back to `PENDING` with zero stock impact.
- Integration: HMO item with `coPayPct = 30` holds the whole item gated
  (nothing dispensed, nothing drawn), then releases the full quantity in
  one step once the invoice is paid; `coPayPct = 0` dispenses the whole
  item immediately with no gate at all.
- Integration: a patient with an active `ADMITTED` admission bypasses the
  gate entirely regardless of the tenant setting (depends on F1's
  `resolveBillingTarget`).
- Integration: `pharmacy:dispense-emergency-override` without a reason is
  rejected; with a reason, dispenses immediately and is audited; a role
  without the permission is rejected by `assertCan`.
- Integration: two preparations for the same visit that end up on primary
  vs. supplementary invoices (because the primary got locked in between)
  each release independently once their own specific invoice is paid.
- Web: dispensing queue shows "Awaiting payment" vs. "Paid - ready to
  dispense" correctly and live (manual pass per the usability test plan's
  new F2 cases - setting on/off, payment gate, exemptions, emergency
  override; see `phase1-status.md`).

## 11. Effort estimate

| Piece | Size |
|---|---|
| Schema (`Tenant` setting, `PrescriptionItem` prepared* fields, `AWAITING_PAYMENT` status) | S |
| `prepare()` / `release()` / `cancel-preparation()` service methods | M |
| HMO co-pay split logic (reuses `claims.service.ts`'s existing resolution) | S |
| Inpatient exemption (depends on F1's `resolveBillingTarget`) | S (if F1 ships first) |
| Emergency override | S |
| Dispensing queue UI (live status join, Release/Cancel actions) | M |
| Overrides/admin report (emergency dispenses) | S |
| Tests (section 10) | M |

**Overall: Medium** - smaller than F1 because it reuses F1's billing-target
resolution and item 9's line-removal/audit machinery rather than building
new primitives; the main real work is the prepare/release state machine and
the queue UI. Built **after** F1, so the inpatient exemption had
`resolveBillingTarget` ready to call.

## 12. Implementation notes

- **Whole-item hold, not a quantity or money split (changed 2026-10-08).**
  The original design split both the quantity and the charge
  proportionally (`coveredQty = round(delta * (1 - coPayPct / 100))`,
  `coPayQty = delta - coveredQty`, two separate `InvoiceLine`s) so that a
  30%-co-pay delta of 10 became 7 dispensed immediately and 3 gated. In
  practice this meant a patient could watch part of their prescription
  come out of the bag with no clear reason why only some of it did, and
  the queue had to represent a single item as simultaneously
  dispensed-and-awaiting. Replaced with a binary branch in `prepare()`:
  `coPayPct <= 0` dispenses the whole delta now (unchanged); any co-pay
  above 0 posts **one** `InvoiceLine` for the full delta at the item's
  real price and holds the full quantity as `preparedQty` - nothing
  dispenses, no stock moves, until `release()` confirms the invoice is
  paid, at which point the full quantity draws and dispenses in one step.
  `splitCoPayQty()` was deleted rather than kept dead. This does not
  change what a claim later charges the HMO: the invoice line still
  carries the item's full real price, and `ClaimsService.generate()`
  computes the HMO/patient split from the pooled invoice total afterward,
  exactly as it already does for every other billable line on an HMO
  visit - the split was never something pharmacy needed to pre-compute.
- **The release gate checks the patient's own payable share, not the
  whole invoice (changed 2026-10-09).** Raised as a direct consequence of
  the whole-item-hold change above: once an HMO co-pay item's `InvoiceLine`
  carries the full gross amount (not just the patient's fraction), gating
  on `invoice.status === 'PAID'` would mean waiting on the HMO's own share
  too - settled only weeks later at remittance, so a patient who had
  already paid their own co-pay in full could never collect their drugs.
  New `patientPayableAmount()` reuses `resolveCoPay()` (the exact same
  resolver the gate's co-pay decision and `ClaimsService.generate()` both
  use) to compute `invoice.totalAmount * coPayPct / 100`, and `release()`/
  `queue()` compare total payments against *that*, not the invoice's full
  total. A cash patient (`coPayPct` resolves to 100%) still needs the
  whole invoice paid - the fix is specific to HMO co-pay patients, and
  does not touch BL-4's separate, still-open "other uncovered charges on
  the same invoice" friction (the Alternative-considered note above).
- **No insurance provider linked at all resolves to 100% co-pay (fully
  gated), not "exempt."** Section 5's "`coPayPct` is 0 or unset -> exempt"
  describes a *resolved* HMO provider with no co-pay percentage set, not a
  cash patient with no provider at all - the latter is precisely who F2
  exists to gate. `resolveCoPay()` returns 100 whenever no `InsuranceProvider`
  resolves (by id or by name-match), and only reads `defaultCoPayPct` (0
  treated as fully exempt) once a provider is actually found.
- **`dispense()`'s status computation was refactored to use the same
  `computeDispenseStatus()` helper `prepare()`/`release()`/
  `cancelPreparation()` use**, rather than keeping its own narrower
  `allDispensed` check. The old and new logic agree exactly whenever no
  item has ever been prepared (every pre-existing `pharmacy.int-spec.ts`
  test still passes unchanged); the refactor only matters once a
  prescription can have some items dispensed and others still prepared at
  the same time, which the old logic had no way to represent.
- **`cancel-preparation` reuses `BillingService.voidInvoiceLine` directly,
  not the actor-gated `removeInvoiceLine`.** A PHARMACIST has
  `prescription:dispense` but not `billing:manage`, so calling the public,
  permission-checked `removeInvoiceLine` with a pharmacy actor would be
  rejected outright - `prescription:dispense` is the correct gate for this
  specific action, the same reasoning `BillingService.postPaymentTx`
  already established for a system-level write with no actor check of its
  own. One edge case `removeInvoiceLine` does not need to handle but this
  does: if the prepared line is the invoice's only line, the invoice is
  cancelled outright instead of being left at zero lines, since pharmacy
  staff have no separate "cancel this invoice" tool to reach for afterward.
- **The admin-facing overrides report** (section 5) shipped as
  `GET /pharmacy/dispense-overrides-report`, gated `pharmacy:manage` like
  `off-formulary-report` already is, mirroring
  `BillingService.lineEditsReport`'s shape rather than extending it - the
  two audit trails (invoice line edits vs. emergency dispense overrides)
  are different entity types with different metadata, so a clean sibling
  endpoint reads better than a shared one with optional fields.
- **"Paid, ready to dispense" is computed on every `queue()` read**, not
  stored - a batched join from every returned prescription's prepared
  `InvoiceLine`s to their parent invoices' current `status`, so a payment
  reversal is reflected on the very next queue read with nothing to
  reconcile separately, exactly as section 6 specifies.
