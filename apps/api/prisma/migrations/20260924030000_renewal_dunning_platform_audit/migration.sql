-- Auto-renewal / dunning fields on Subscription, and a durable platform-level
-- audit log (platform actions have no tenantId, so they cannot use AuditLog).

-- AlterTable
ALTER TABLE "Subscription"
  ADD COLUMN "paystackAuthorizationCode" TEXT,
  ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "dunningAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastRenewalAttemptAt" TIMESTAMP(3),
  ADD COLUMN "nextRenewalAttemptAt" TIMESTAMP(3),
  ADD COLUMN "trialEndingReminderSentAt" TIMESTAMP(3),
  ADD COLUMN "readOnlyNoticeSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT,
    "tenantId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);
