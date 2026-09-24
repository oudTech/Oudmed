-- Platform-wide operational settings (Super Admin > Settings > General) plus a
-- maintenance-mode switch enforced in JwtStrategy for every hospital request.
-- Not tenant-scoped - same category as PlatformPricing/PlatformUser,
-- deliberately absent from rls.sql.

CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL,
    "platformName" TEXT NOT NULL DEFAULT 'OudHealth',
    "supportEmail" TEXT,
    "supportPhone" TEXT,
    "supportHours" TEXT,
    "logoUrl" TEXT,
    "defaultCountry" TEXT NOT NULL DEFAULT 'NG',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'NGN',
    "timeFormat" TEXT NOT NULL DEFAULT '12h',
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

-- Seed the one config row this deploy will use, mirroring PlatformPricing's
-- single-row pattern.
INSERT INTO "PlatformConfig" ("id", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000002', CURRENT_TIMESTAMP);
