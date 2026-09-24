-- Row-Level Security: tenants can never see each other's data.
-- The app sets `app.tenant_id` per transaction (PrismaService.forTenant);
-- these policies enforce it at the database layer.
--
-- The running API connects as `oudhealth_app` (NOSUPERUSER, NOBYPASSRLS - see
-- prisma/setup-app-role.ts), so these policies bite. Migrations, `seed` and this
-- script run as the database owner.
--
-- NOT listed here (deliberately):
--   User, PendingRegistration, EmailVerification, PasswordReset, AuthTicket, UserDepartment
-- The auth layer reads these before any tenant context exists (login resolves
-- the tenant from the subdomain, then looks up the user). Tenant-scoped reads
-- of User (the HR module) filter by `tenantId` explicitly in the query.
--
--   Tenant, PlatformPricing, PlatformSequence, PlatformWebhookEvent
-- None has a tenantId column - Tenant IS the tenant boundary, and the other
-- three are global platform state shared across every tenant.
--
-- Kept as a single DO block: apply-rls.ts sends the file as one statement.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Department','Ward','Bed','DoctorShift','Patient','PatientDocument',
    'Complaint','Diagnosis','VitalSigns','Prescription','ClinicalNote','ClinicalOrder',
    'Drug','DrugBatch','StockMovement','InsuranceProvider',
    'InsuranceClaim','InsuranceClaimLine','ClaimBatch','ClaimRemittance','ClaimRemittanceAllocation',
    'StoredFile','TenantSequence',
    'Visit','Admission','ServiceItem','Invoice','InvoiceLine','Payment',
    'PrescriptionItem','Subscription','SubscriptionInvoice'
  ]
  LOOP
    EXECUTE format('ALTER TABLE "%s" ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE "%s" FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON "%s";', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON "%s"
      USING ("tenantId" = current_setting('app.tenant_id', true))
      WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
    $f$, t);
  END LOOP;

  -- AuditLog: reads are tenant-scoped, but INSERTs are always allowed.
  -- AuditService writes append-only rows (each with an explicit tenantId) from
  -- outside any forTenant transaction - including mid-transaction from
  -- billing/claims, where opening a nested forTenant would risk a hang. There is
  -- no cross-tenant audit read path in the app.
  ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
  DROP POLICY IF EXISTS audit_select ON "AuditLog";
  DROP POLICY IF EXISTS audit_insert ON "AuditLog";
  CREATE POLICY audit_select ON "AuditLog"
    FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
  CREATE POLICY audit_insert ON "AuditLog"
    FOR INSERT WITH CHECK (true);

  -- Re-grant the runtime role on every table/sequence. setup-app-role.ts creates
  -- the role and does the first grant; doing it again here means `pnpm prisma:rls`
  -- after a migration that adds tables is enough - you don't also have to
  -- remember `pnpm db:setup-role`. No-op if the role does not exist yet.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oudhealth_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO oudhealth_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO oudhealth_app;
  END IF;
END $$;

-- NOTE: the policies compare text = text (`"tenantId"` is a text column, and
-- current_setting() returns text). That is intentional and index-friendly - do
-- not "fix" it with a ::uuid cast.
