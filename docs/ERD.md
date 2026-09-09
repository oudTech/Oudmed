# Database ERD

The authoritative schema is
[apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma) (~40 models).
This diagram shows only the **core money-loop entities**; the clinical
(Complaint / Diagnosis / VitalSigns / Prescription / ClinicalNote / ClinicalOrder),
pharmacy (Drug / DrugBatch / StockMovement), admissions (Ward / Bed / Admission),
claims (InsuranceClaim / ClaimBatch / ClaimRemittance), storage (StoredFile) and
`TenantSequence` (gapless invoice / receipt numbering) tables are omitted for
readability.

Every tenant-scoped table carries `tenantId` and has a matching policy in
[apps/api/prisma/rls.sql](../apps/api/prisma/rls.sql). RLS is enforced because the
API connects as a NOSUPERUSER / NOBYPASSRLS role.

```mermaid
erDiagram
    TENANT ||--o{ USER : has
    TENANT ||--o{ PATIENT : has
    TENANT ||--o{ DEPARTMENT : has
    TENANT ||--o{ VISIT : has
    TENANT ||--o{ SERVICE_ITEM : has
    TENANT ||--o{ INVOICE : has
    TENANT ||--o{ PAYMENT : has
    TENANT ||--o{ AUDIT_LOG : has

    PATIENT ||--o{ VISIT : attends
    PATIENT ||--o{ INVOICE : billed
    USER ||--o{ VISIT : "doctor on"
    DEPARTMENT ||--o{ VISIT : hosts
    VISIT ||--o| INVOICE : generates
    INVOICE ||--o{ INVOICE_LINE : contains
    INVOICE ||--o{ PAYMENT : "settled by"
    SERVICE_ITEM ||--o{ INVOICE_LINE : "priced in"
    USER ||--o{ PAYMENT : "received by"
    USER ||--o{ AUDIT_LOG : "acted"

    TENANT {
      uuid id PK
      string name
      string slug UK
      enum plan
      bool isActive
    }
    USER {
      uuid id PK
      uuid tenantId FK
      string email
      string passwordHash
      string fullName
      enum role
      bool isActive
    }
    PATIENT {
      uuid id PK
      uuid tenantId FK
      string patientNumber
      string firstName
      string lastName
      date dateOfBirth
      string gender
      string phone
    }
    DEPARTMENT {
      uuid id PK
      uuid tenantId FK
      string name
    }
    VISIT {
      uuid id PK
      uuid tenantId FK
      uuid patientId FK
      uuid doctorId FK
      uuid departmentId FK
      enum visitType
      enum status
      datetime scheduledAt
    }
    SERVICE_ITEM {
      uuid id PK
      uuid tenantId FK
      string name
      string category
      decimal unitPrice
    }
    INVOICE {
      uuid id PK
      uuid tenantId FK
      uuid patientId FK
      uuid visitId FK
      string invoiceNumber
      enum status
      decimal totalAmount
    }
    INVOICE_LINE {
      uuid id PK
      uuid invoiceId FK
      uuid serviceItemId FK
      string description
      int quantity
      decimal unitPrice
      decimal lineTotal
    }
    PAYMENT {
      uuid id PK
      uuid tenantId FK
      uuid invoiceId FK
      decimal amount
      enum method
      uuid receivedById FK
    }
    AUDIT_LOG {
      uuid id PK
      uuid tenantId FK
      uuid userId FK
      string action
      string entityType
      string entityId
    }
```
