-- Restore optional completion timestamp as metadata only.
-- Workflow truth remains PlanStudyStep.status.
-- Existing DONE rows keep completedAt NULL (prior migration dropped timestamps;
-- do not fabricate historical or migration-time completion dates).
ALTER TABLE "PlanStudyStep" ADD COLUMN "completedAt" TIMESTAMP(3);
