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
answered at the *invoice* level - the invoice carrying the prepared line
must reach `PAID` status, not merely `PARTIAL`. If other, unrelated charges
share that invoice and remain unpaid, release stays blocked until the whole
invoice is settled. This is a real trade-off of the current billing model,
not an oversight; a future per-line reservation/payment model would relax
it, but is out of scope here. In practice this rarely bites: a prepared
pharmacy charge usually shares an invoice with that same visit's
consultation/lab charges, which a patient typically settles together at the
same billing-desk visit.

### Release (`POST /pharmacy/prescriptions/:id/release`)

For each item with `preparedQty > 0`: re-fetch `preparedInvoiceLineId`'s
parent invoice (never trust a cached "paid" flag from the queue) and confirm
`invoice.status === 'PAID'`. If so: draw stock via the existing
`drawStockFefo` (same FEFO/expiry-cutoff logic, unchanged) for
`preparedQty`, set `dispensedQty += preparedQty`, `dispenseUnitPrice =
preparedUnitPrice`, clear the `prepared*` fields, and mark the item
physically handed over. If the invoice is not yet `PAID`, the item is left
untouched and reported back as still awaiting payment - release is
all-or-nothing per item, never a partial stock draw for a partially
resolved invoice. Audited (`RELEASE_DISPENSE`).

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

Resolved identically to `ClaimsService.generate()`'s existing co-pay logic
(`claims.service.ts:392-413`), reused rather than reinvented: given the
visit's (or patient's) linked `InsuranceProvider`, read `defaultCoPayPct`.

- **`coPayPct` is 0 or unset** → the entire line is HMO-covered → exempt,
  dispensed immediately, no gate at all.
- **`coPayPct` is between 0 and 100** → the charge is split into two
  `InvoiceLine`s for that item: a covered portion
  (`lineTotal * (1 - coPayPct/100)`), dispensed immediately and exempt from
  the gate, and a co-pay portion (`lineTotal * coPayPct/100`), which goes
  through the normal prepare/await-payment/release flow like a cash charge.
  Both lines reference the same `PrescriptionItem` for traceability; the
  item's own `dispensedQty` reflects the exempt (covered) portion
  immediately, and `preparedQty` tracks the co-pay portion separately until
  released - the item can therefore show as partially-dispensed-partially-
  awaiting, which the queue surfaces plainly (section 7) rather than
  collapsing into one ambiguous status.

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

- **"Awaiting payment"** - `preparedQty > 0`, parent invoice not yet `PAID`.
- **"Paid - ready to dispense"** - `preparedQty > 0`, parent invoice is
  `PAID`. Computed live by joining to the invoice on read, never cached, so
  a payment reversal (item 9's existing `reversePayment`) is immediately
  reflected back to "Awaiting payment" with no separate reconciliation step.

A "Release" button appears only in the second state; a "Cancel
preparation" (with the mandatory reason field, same inline pattern as item
9's remove-line confirm) appears in both gated states.

## 7. Co-pay and supplementary invoices together

Two things that already exist compose cleanly here, by design rather than
by accident:

- **Co-pay** splits one item's charge into an exempt line and a gated line
  (section 5) - both can land on the same open invoice for the visit, since
  both `postCharge` calls happen inside the same transaction against the
  same resolved invoice.
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
- **Partial payment, invoice `PARTIAL` not `PAID`** → release blocked for
  every item on that invoice (section 4's stated constraint), reported
  clearly rather than silently doing nothing.
- **Two different prescriptions share one invoice, one pays, one doesn't**
  → not possible for *this* constraint to misfire, since release checks are
  per-item against that item's own specific invoice; if both prescriptions'
  prepared lines are on the same invoice, both are gated by the same
  invoice's status (expected, since it is genuinely one unsettled bill).
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
  release after the invoice reaches `PAID` draws stock correctly via the
  existing FEFO/expiry logic; release attempted while the invoice is still
  `PARTIAL`/`UNPAID` is rejected and makes no stock change.
- Integration: cancel-preparation voids the invoice line (reusing
  `removeInvoiceLine`), requires a reason, is audited, and resets the item
  back to `PENDING` with zero stock impact.
- Integration: HMO item with `coPayPct = 30` splits into an immediately-
  dispensed covered line and a gated co-pay line; `coPayPct = 0` dispenses
  the whole item immediately with no gated line at all.
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
the queue UI. Should be built **after** F1 so the inpatient exemption has
something to call.
