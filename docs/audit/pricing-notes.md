# Pricing model notes (input for the billing/HMO review)

Recorded 2026-09-30 while fixing FUNC-1 (pharmacy) and its sweep (clinical
orders). Read this before designing any payer-specific pricing or HMO tariff
work - it establishes what pricing model actually exists today.

## No per-payer / HMO tariff or price list exists anywhere

Grepped the whole API for `tariff`, `payerPrice`, `hmoPrice`, `priceList` -
zero hits. There is no concept anywhere in the schema or code of a drug or
service having a different price for a different insurance provider, HMO, or
payer type. **Every charge uses exactly one catalogue price regardless of
who's paying** - `PayerType` (CASH / HMO) affects how a charge is billed and
collected (invoice routing, claims, remittance), never what it costs.

## The one price per item, and where it lives

- Services/procedures/labs/imaging: `ServiceItem.unitPrice` (one field, no
  payer variants). Set via Administration > Services, `admin:settings`
  (HOSPITAL_ADMIN only).
- Drugs: `Drug.sellPrice` (one field). Set via Pharmacy > Inventory,
  `pharmacy:manage` (PHARMACIST / HOSPITAL_ADMIN).

If HMO-specific pricing is ever wanted, it needs a real new concept (e.g. a
`Tariff`/`PriceListEntry` table keyed by `(insuranceProviderId, serviceItemId
| drugId)`), not a variant of the existing single-price fields. This is a
schema-level decision, not a quick patch.

## Every charge-creation path, audited 2026-09-30 (FUNC-1 sweep)

| Path | File:line | Who can reach it | Price source | Client-influenced? |
|---|---|---|---|---|
| Consultation charge (auto, on visit check-in) | `schedule.service.ts:279-299` | Triggered by whoever checks in a visit; no direct price-setting call | `ServiceItem.unitPrice` (category=Consultation) | No - zero client input, always catalogue |
| Clinical order (lab/imaging/procedure) | `encounters.service.ts` `createOrder()` | DOCTOR, NURSE, HOSPITAL_ADMIN (`order:create`) | `ServiceItem.unitPrice`, override only with `billing:manage` + reason | **Fixed 2026-09-30** (was fully client-priced; not reachable via the shipped web UI, which never sent `unitPrice` - but reachable via direct API access) |
| Pharmacy dispense | `pharmacy.service.ts` `dispense()` | PHARMACIST, HOSPITAL_ADMIN (`prescription:dispense`) | `Drug.sellPrice`, override only with `billing:manage` + reason | **Fixed 2026-09-30** (was fully client-priced and live-reachable via the dispensing UI) |
| Manual/ad-hoc invoice | `billing.service.ts` `createInvoice`/`createInvoiceTx` | RECEPTIONIST, ACCOUNTANT, HOSPITAL_ADMIN (`billing:manage`) | Client-typed per line - by design, this is the manual-pricing path | Yes, legitimately - already gated by `billing:manage` and audited (`CREATE`/`Invoice`) |
| HMO write-off / shortfall adjustment | `claims.service.ts` `postAdjustment()`, called from `writeOff()` and `recordRemittance()` | HOSPITAL_ADMIN, ACCOUNTANT (`claims:manage`) | Server-computed (`claimedAmount - paidAmount - writeOffAmount`), never a raw client number | No |
| Invoice line removal | `billing.service.ts` `removeInvoiceLine()` | `billing:manage` | N/A - deletes a line, sets no price | No |
| Invoice-level discount/note/category edit | `billing.service.ts` `updateInvoice()` | `billing:manage` | N/A - never touches `unitPrice` | No |
| Service/drug catalogue price-setting | `admin.service.ts` (ServiceItem CRUD), `inventory.service.ts` (Drug CRUD) | `admin:settings` / `pharmacy:manage` | N/A - this is where prices come from | By design - the source of truth itself |
| Admissions / ward / bed charges | (searched, none found) | N/A | No charge-creation path exists yet | Not applicable - feature doesn't exist |

**Off-formulary / off-catalogue pricing: fixed 2026-09-30.** Both paths now
require a reason and are always audited (`OFF_FORMULARY_DISPENSE` /
`OFF_CATALOGUE_ORDER` - drug/item name, price, reason, who, visit),
regardless of role, since there's no catalogue to validate the price
against. The prescribing UI also now blocks a typo from silently becoming
an untracked off-formulary item (a "did you mean" confirmation is required
before one can be added). A "Off-formulary dispenses" report on the
Inventory tab (`GET /pharmacy/off-formulary-report`) shows which
non-catalogue drugs are dispensed often enough to add to the formulary.

## Admissions / ward / bed stays: no billing exists (potential go-live blocker)

Confirmed 2026-09-30: `Ward` (`schema.prisma:814-828`) and `Bed`
(`schema.prisma:830-844`) have **no rate/price field at all** - this isn't a
wiring bug, pricing for inpatient stays was never designed into the schema.
`AdmissionsService` (`apps/api/src/admissions/admissions.service.ts`)
implements `admit`, `transfer`, `discharge`, `update`, `list`, `getOne` -
none of them call `postChargeToVisit`, create an invoice line, or reference
any price at all. What exists today:

- **Admit:** assign a patient to a ward/bed, with an admitting/attending
  doctor and department. No charge posted.
- **Transfer:** move the patient to a different bed/ward. No charge posted.
- **Discharge:** close the admission. No charge posted.
- There is no concept anywhere of a daily bed rate, a ward-tier price, or a
  length-of-stay calculation.

**If this hospital runs inpatient wards, this is a real gap**, not a
polish item: every day a patient occupies a bed today generates zero
revenue in the system. Fixing it is a real feature (schema: a rate on
`Ward` or a `WardRate` table; logic: a per-day or per-discharge charge
calculation; decision: charged daily, at discharge, or both) rather than a
quick patch, and should be scoped as its own item once confirmed needed.
