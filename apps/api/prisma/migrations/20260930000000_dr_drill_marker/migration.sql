-- Disaster-recovery restore drills only (docs/OPERATIONS_GUIDE.md). A tiny,
-- isolated table used to plant a known marker row before a Neon point-in-time
-- restore drill and confirm it reappears correctly after restoring a branch
-- to a moment before the row was deleted/changed. Not tenant-scoped, holds no
-- real data, deliberately absent from rls.sql.

CREATE TABLE "DrillMarker" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrillMarker_pkey" PRIMARY KEY ("id")
);
