-- Malware-scan status per stored file. Existing rows default to SKIPPED (they
-- pre-date the scanner). New uploads are CLEAN / INFECTED when a scanner is
-- configured (CLAMAV_HOST), else SKIPPED.

ALTER TABLE "StoredFile"
  ADD COLUMN "scanStatus" TEXT NOT NULL DEFAULT 'SKIPPED',
  ADD COLUMN "scannedAt" TIMESTAMP(3);
