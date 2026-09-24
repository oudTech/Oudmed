-- Platform subscription billing (Phase 1: pricing + entitlement calc + trial,
-- no payment collection yet). PlatformPricing is global config, deliberately
-- not tenant-scoped - same category as Tenant itself, not listed in rls.sql.
-- Subscription is tenant-owned data - added to rls.sql's tenant_isolation loop.

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "trialEndsAt" TIMESTAMP(3) NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPricing" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "adminSeatPriceMonthly" DECIMAL(12,2) NOT NULL,
    "otherSeatPriceMonthly" DECIMAL(12,2) NOT NULL,
    "annualDiscountPct" DECIMAL(5,2) NOT NULL,
    "trialDays" INTEGER NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the one pricing row this deploy will use. Values are the current
-- decision (role-based: HOSPITAL_ADMIN seats vs every other role, 14-day
-- trial, 15% annual discount) and are meant to be edited in place later, not
-- redeployed - see PlatformPricing model comment.
INSERT INTO "PlatformPricing" ("id", "adminSeatPriceMonthly", "otherSeatPriceMonthly", "annualDiscountPct", "trialDays", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 20000.00, 5000.00, 15.00, 14, CURRENT_TIMESTAMP);

-- Backfill: every existing tenant gets a subscription row so none are left
-- without one. Existing tenants are treated as already-trialing from now,
-- rather than guessing a historical signup date.
INSERT INTO "Subscription" ("id", "tenantId", "status", "billingCycle", "trialEndsAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'TRIALING', 'MONTHLY', CURRENT_TIMESTAMP + INTERVAL '14 days', CURRENT_TIMESTAMP
FROM "Tenant";
