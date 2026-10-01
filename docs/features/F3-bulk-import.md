# F3: Bulk patient import (onboarding)

Status: design, not yet built. Scope-change item (2026-10-01) - promoted from
backlog to a Phase 1 launch blocker.

## 1. What exists today

- **Nothing server-side for patient import at all.** The only existing bulk
  import in the codebase is pharmacy's drug CSV import
  (`apps/web/components/pharmacy/ImportDrugsModal.tsx` +
  `drugsApi.importDrugs`): parsed **client-side** with a hand-rolled
  `parseCsv()` (`apps/web/lib/pharmacy.ts`), sent as one JSON array to a
  single synchronous endpoint, no dry run, no duplicate handling beyond
  "match by SKU/name and update," no background processing, no undo. F3 is
  a materially bigger feature than this precedent, not a copy of it - but
  the precedent is worth reusing for its UI shape (template download, file
  picker, row preview table, per-row error list).
- **No CSV or Excel parsing library** is installed on either side
  (confirmed: no `xlsx`/`exceljs`/`csv-parse`/`papaparse` in either
  `package.json`). A server-side parsing dependency is new work, not a
  wiring gap (section 6).
- **No background-job/queue infrastructure** beyond `@nestjs/schedule`'s
  cron jobs (used by subscription renewals, and by F1's nightly bed-charge
  job). There is no task queue (no Bull/Redis). Given this app's realistic
  scale (a single hospital's patient list - hundreds to a few thousand
  rows, not millions), F3 does not need to introduce one: a fire-and-forget
  async job on the same Node process, with the frontend polling a status
  endpoint, is consistent with the rest of the codebase and avoids a new
  piece of infrastructure. The stated limitation: progress is lost if the
  process restarts mid-import (acceptable at this scale; the batch and row
  rows persist, so a stuck batch is visible and can be investigated rather
  than silently vanishing).
- **Duplicate-detection logic already exists and should be reused, not
  reinvented**: `PatientsService.checkDuplicates()` (`patients.service.ts:370`)
  already matches on phone (`contains`) and on
  last-name-exact + first-three-letters-of-first-name, used today by the
  registration wizard's step-1 dedupe screen. F3's against-existing-patients
  check uses this exact logic.
- **HMO name-to-provider matching already exists and should be reused**:
  `ClaimsService.generate()` (`claims.service.ts:396-406`) already does a
  case-insensitive `InsuranceProvider.name` match against a free-text HMO
  name string, with a graceful "no match" fallback. F3's insurer-mapping
  step uses this exact pattern.
- **No `legacyPatientNumber` field exists on `Patient`** - a genuine schema
  gap, needed fresh for this feature.
- **File uploads already go through `StorageModule`/`uploadInterceptor`**
  (`apps/api/src/storage/upload.util.ts`, used by document/photo/logo
  uploads) - the import file upload reuses this, not a new upload path.

## 2. Schema

```prisma
enum ImportBatchStatus {
  PENDING
  VALIDATING
  VALIDATED
  IMPORTING
  COMPLETED
  FAILED
  UNDONE
}

enum ImportRowStatus {
  PENDING
  VALID
  WARNING
  ERROR
  IMPORTED
  SKIPPED
}

model PatientImportBatch {
  id             String            @id @default(uuid())
  tenantId       String
  tenant         Tenant            @relation(fields: [tenantId], references: [id])
  name           String            // defaults to the uploaded filename
  fileName       String
  status         ImportBatchStatus @default(PENDING)
  totalRows      Int               @default(0)
  processedRows  Int               @default(0)
  createdCount   Int               @default(0)
  mergedCount    Int               @default(0)
  skippedCount   Int               @default(0)
  errorCount     Int               @default(0)
  errorReportRef String?           // stored-file reference, downloadable
  createdById    String?
  createdAt      DateTime          @default(now())
  completedAt    DateTime?
  undoneAt       DateTime?
  undoneById     String?
  undoReason     String?

  rows PatientImportRow[]

  @@index([tenantId])
}

model PatientImportRow {
  id          String          @id @default(uuid())
  tenantId    String
  tenant      Tenant          @relation(fields: [tenantId], references: [id])
  batchId     String
  batch       PatientImportBatch @relation(fields: [batchId], references: [id])
  rowNumber   Int
  rawData     Json            // the parsed row as uploaded, for preview/debugging/error report
  status      ImportRowStatus @default(PENDING)
  errors      Json?           // [{ field, message }]
  warnings    Json?           // [{ field, message }] - e.g. "unknown insurer, stored as free text"
  duplicateOfPatientId String? // set when matched against an existing patient
  withinFileDuplicateOfRow Int? // set when matched against an earlier row in the same file
  resolution  String?         // 'skip' | 'merge' | 'import' - only meaningful when a duplicate was found
  patientId   String?         // the resulting Patient.id, once actually imported

  @@index([batchId])
  @@index([tenantId])
}

model Patient {
  // ...existing fields...
  legacyPatientNumber String?
  importBatchId       String?
  importBatch         PatientImportBatch? @relation(fields: [importBatchId], references: [id])

  @@index([tenantId, legacyPatientNumber])
}
```

`legacyPatientNumber` is a plain searchable text field (not unique - two
different legacy systems could coincidentally reuse a number scheme), shown
on the patient chart and included in patient search. `importBatchId` is
what makes undo precise (section 5) and what a Hospital Admin uses to find
"everyone who came in from the March import."

## 3. Flow

### Upload (dry run starts immediately - not a separate opt-in step)

`POST /patients/import/upload` (multipart, reusing `uploadInterceptor`) -
accepts `.csv` or `.xlsx`. Creates a `PatientImportBatch`
(`status: PENDING`) and, synchronously, parses the file into
`PatientImportRow` rows (`status: PENDING`, `rawData` = the parsed row) -
parsing is fast and cheap even for a few thousand rows, so this part stays
in the request/response cycle; only *validation* (which does DB lookups per
row) moves to the background. Returns `{ batchId }` immediately, and kicks
off validation as a fire-and-forget async call.

### Validate (the dry run)

Runs per row, in the background, updating `PatientImportBatch.processedRows`
as it goes so the UI can show a progress bar:

1. **Field validation** - required: `firstName`, `lastName` (the only two
   `CreatePatientDto` actually requires); everything else optional but
   format-checked when present (date format for `dateOfBirth`/
   `insuranceExpiry`, a recognisable phone shape, enum values for
   `gender`/`maritalStatus`/`bloodGroup`/etc. matched case-insensitively).
   A field that fails format validation is an **error** (blocks import for
   that row); a recognised-but-unusual value (e.g. a phone number with an
   unexpected length) is a **warning** (importable, flagged for review).
2. **Duplicate detection**:
   - **Against existing patients** - reuses `PatientsService`'s own
     matching rule (phone contains-match, or last-name-exact +
     first-three-letters-of-first-name) exactly, so "is this a duplicate"
     never means something different in bulk import than it does in the
     registration wizard's own dedupe screen.
   - **Within the file** - the same matching rule applied against rows seen
     earlier in the same batch, so two rows for the same person inside one
     spreadsheet are caught before either is ever imported.
   - Either kind sets `duplicateOfPatientId` or `withinFileDuplicateOfRow`
     and defaults `resolution` to **`'skip'`** - the safe default proposed
     here: assume it is the same person and do not create a second record
     unless a human explicitly overrides it. `'merge'` and `'import'`
     (force a new record anyway - e.g. genuine twins sharing a name/phone)
     are the opt-in choices (section 4).
3. **Insurer mapping** - an `insuranceProvider`/HMO name column is matched
   against `InsuranceProvider.name` case-insensitively, exactly like
   `ClaimsService.generate()` already does. A match sets
   `insuranceProviderId` on the eventual `Patient`; no match is a
   **warning** ("Unknown insurer '<name>' - will be stored as free text
   only, not linked"), not an error - the row still imports, just without a
   structured insurer link, since blocking an entire patient record on an
   unrecognised HMO name would be disproportionate.
4. Row `status` is set to `VALID` (no issues), `WARNING` (importable with
   caveats), or `ERROR` (blocks import for that row). Batch `status`
   becomes `VALIDATED` once every row has been processed, with
   `errorCount`/a count of `WARNING` rows available for the summary.

### Review (the preview)

`GET /patients/import/:id` - batch summary + paginated rows with their
status/errors/warnings/duplicate info, for the dry-run preview table (row-
level errors and warnings, as asked). `GET /patients/import/:id/error-report`
- downloads a CSV of just the `ERROR` rows with their original data plus a
"why" column, so a hospital can fix the source spreadsheet and re-upload
just the corrections rather than redo the whole file.

### Resolve duplicates

`PATCH /patients/import/:id/rows/:rowId` `{ resolution: 'skip' | 'merge' | 'import' }`
- only valid on a row that has a duplicate match. `'merge'` is defined
narrowly and safely: fill in any field that is **blank on the existing
patient** from the imported row's value; never overwrite a field the
existing record already has a value for. This is a deliberate conservative
default - a bulk import should enrich an existing record, never silently
clobber data a hospital has already corrected by hand.

### Commit

`POST /patients/import/:id/commit` - moves the batch to `IMPORTING` and
processes every `VALID`/`WARNING` row not resolved as `'skip'`, in the
background, updating `processedRows`/`createdCount`/`mergedCount` as it
goes (polled by the UI, same mechanism as validation's progress bar). Each
created `Patient` gets `registrationStatus: COMPLETE` (it arrived with real
data, not a half-finished wizard), `legacyPatientNumber` set from the
source row if present, a freshly generated `patientNumber` via the existing
`nextSequence`-backed sequence (never reusing the legacy number as the real
one - the two are deliberately kept separate, per the brief), and
`importBatchId` set. `ERROR` rows and rows resolved `'skip'` are recorded as
`SKIPPED` with no `Patient` created. On completion: `status: COMPLETED`,
`completedAt` set; on an unrecoverable failure partway through: `status:
FAILED`, with whatever rows already completed left as real patients (no
blanket rollback of a large batch over one bad row - row-level failure is
isolated to that row, consistent with how validation already isolates
errors per row rather than failing the whole file).

### Undo

`POST /patients/import/:id/undo` `{ reason }` - only on a `COMPLETED` batch.
For every `Patient` with `importBatchId` = this batch: deletable only if it
has **no clinical or billing activity** - checked by confirming every one
of its relation arrays is empty (`visits`, `admissions`, `invoices`,
`documents`, `complaints`, `diagnoses`, `vitals`, `prescriptions`, `notes`,
`noteAddenda`, `orders`, `claims` - the full relation list already declared
on `Patient`, `schema.prisma:947-958`). Patients with activity are left
alone and reported back explicitly ("12 of 40 patients kept - they already
have activity"), never silently skipped without saying so. Deletable
patients are hard-deleted (this is explicitly an undo of a batch that
should not have happened, not a soft-archive); batch moves to `UNDONE`,
audited (`IMPORT_UNDO`, metadata: batch id, reason, counts).

## 4. Screens

- **`/patients/import`** (new, Hospital-Admin-only): upload step (file
  picker + "Download template" + the field guide), then the dry-run preview
  (summary counts, paginated row table with status/errors/warnings,
  per-row duplicate resolution picker for flagged rows, "Download error
  report"), then a progress view during commit (reusing the same progress-
  bar pattern as validation), then a completion summary (created / merged /
  skipped / errors, with a link to the new patients filtered by this
  batch and an "Undo this import" action while still eligible).
- **Patients list**: a new filter/column for "Import batch" so a Hospital
  Admin can find everyone a given import created; `legacyPatientNumber`
  added to patient search (alongside `patientNumber`/name/phone) and shown
  on the patient chart header.
- **Template download**: `GET /patients/import/template` - a CSV with every
  importable column header, a short comment row (or a second sheet, if the
  template is generated as `.xlsx`) naming which columns are required
  (`firstName`, `lastName` only) vs. optional, and the expected date
  (`YYYY-MM-DD`) and phone formats.

## 5. Roles and permissions

| Action | Roles |
|---|---|
| `patient:bulk-import` (new) | HOSPITAL_ADMIN only, per the brief |

Gates the entire `/patients/import` screen and every endpoint under it.
Added to both `permissions.ts` and `apps/web/lib/permissions.ts`.

## 6. New dependency

No CSV/Excel parsing library exists today. Needed: a server-side `.xlsx`
reader (SheetJS `xlsx` is the standard, MIT-licensed choice) and a small,
well-tested CSV parser (`csv-parse` or similar) rather than hand-rolling a
second one from scratch when `lib/pharmacy.ts`'s client-side `parseCsv` only
needs to handle the simple CSV case it already does - F3's file is parsed
server-side (since large files process in the background per the brief,
which means after upload, not in the browser), so this is a new
`apps/api` dependency, not a reuse of the existing client-side parser.

## 7. Edge cases

- **A row with a duplicate match AND a validation error** - the error takes
  precedence (the row cannot import regardless of the duplicate decision);
  shown as an error row, not a duplicate-resolution row.
- **The same legacy patient number appears twice in one file** - not
  treated as an error by itself (legacy numbers are not unique in this
  schema, deliberately, since a merged hospital group's old numbering might
  collide) - only the name/phone/DOB-based duplicate rule above actually
  flags a row.
- **Undo requested after a patient from the batch has since received care**
  - that specific patient is kept (section 3); if every patient in the
    batch now has activity, undo is a no-op that still records the attempt
    and reports "0 of N removed."
- **Re-uploading the same file after fixing errors** - creates a new,
  independent `PatientImportBatch`; F3 does not try to detect "this is the
  same file as before," since the corrected rows are genuinely new data as
  far as the system is concerned, and the within-file/against-existing
  duplicate checks on the second upload naturally catch anything that was
  already successfully imported from the first attempt (it is now an
  "existing patient" as far as the second batch's validation pass is
  concerned).
- **Very large file** (thousands of rows) - progress reporting
  (`processedRows`/`totalRows`) keeps the UI informative during both
  validation and commit; no hard row cap is proposed, but a sanity limit
  (e.g. reject above some large N with a clear message suggesting the file
  be split) is a cheap guard worth adding during build.
- **Excel file with multiple sheets** - only the first sheet is read;
  stated explicitly in the UI copy and the field guide, not left to
  surprise someone with a second "notes" sheet.

## 8. Tests to write

- Unit: field validation rules (required vs. optional, date/phone format,
  enum matching) against a representative set of valid/invalid/warning rows.
- Unit: duplicate detection matches `PatientsService.checkDuplicates`'s own
  rule exactly (same phone-contains and name-prefix logic), both against
  existing patients and within a file.
- Unit: insurer name matching reuses and matches `ClaimsService`'s own
  case-insensitive resolution behaviour.
- Integration: upload → validate → review shows correct per-row status;
  error-report download contains exactly the error rows with readable
  messages.
- Integration: duplicate resolution - default `'skip'` creates no patient
  for a matched row; `'merge'` fills only blank fields on the existing
  patient and never overwrites a populated one; `'import'` creates a second
  patient deliberately.
- Integration: commit creates patients with `legacyPatientNumber` preserved
  and a freshly generated `patientNumber` (never reusing the legacy number),
  `importBatchId` set, `registrationStatus: COMPLETE`.
- Integration: undo removes only patients from the batch with zero activity,
  leaves patients with activity untouched and reports them, and is blocked
  on anything but a `COMPLETED` batch.
- Integration (tenant isolation, matching this codebase's existing TP-001
  pattern in `billing.int-spec.ts`): an import batch and its rows are never
  visible to, or resolvable against, another tenant's patients.
- Web: upload → preview → resolve a duplicate → commit → see the created
  patients → undo, per the usability test plan's new F3 cases (template,
  dry run, duplicates, undo - see `phase1-status.md`).

## 9. Effort estimate

| Piece | Size |
|---|---|
| Schema (`PatientImportBatch`/`Row`, `Patient.legacyPatientNumber`/`importBatchId`) | S |
| Server-side CSV/XLSX parsing (new dependency) | S |
| Validation pass (field checks + duplicate detection reuse + insurer-match reuse) | M |
| Commit pass (create/merge/skip, progress tracking) | M |
| Error report + template generation/download | S |
| Undo (activity check across every Patient relation, hard delete) | S |
| Web: upload/preview/resolve/progress/completion screens | L |
| Tests (section 8) | M |

**Overall: Medium-Large**, mostly in the web screens (a multi-step wizard-
like flow with live progress) rather than the backend logic, which reuses
two already-existing pieces of matching logic (dedupe, insurer-name match)
instead of inventing new ones.
