-- CreateEnum
CREATE TYPE "PlanStudyStepStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- Add status column (default TODO for new rows during migration)
ALTER TABLE "PlanStudyStep" ADD COLUMN "status" "PlanStudyStepStatus" NOT NULL DEFAULT 'TODO';

-- Migrate existing completion data into status
UPDATE "PlanStudyStep" SET "status" = 'DONE' WHERE "completedAt" IS NOT NULL;
UPDATE "PlanStudyStep" SET "status" = 'TODO' WHERE "completedAt" IS NULL;

-- Drop old completion column and index
DROP INDEX IF EXISTS "PlanStudyStep_childId_completedAt_idx";
ALTER TABLE "PlanStudyStep" DROP COLUMN "completedAt";

-- Index for board / next-step queries
CREATE INDEX "PlanStudyStep_childId_status_idx" ON "PlanStudyStep"("childId", "status");
