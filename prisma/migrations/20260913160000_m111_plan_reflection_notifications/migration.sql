-- Milestone 11.1: plan completion reflection + plan notification kinds

ALTER TYPE "AppNotificationKind" ADD VALUE IF NOT EXISTS 'PLAN_RECORD_CREATED';
ALTER TYPE "AppNotificationKind" ADD VALUE IF NOT EXISTS 'PLAN_SCHEDULE_CHANGED';
ALTER TYPE "AppNotificationKind" ADD VALUE IF NOT EXISTS 'PLAN_STEP_COMPLETED';
ALTER TYPE "AppNotificationKind" ADD VALUE IF NOT EXISTS 'PLAN_EXTRACT_BATCH';

ALTER TABLE "PlanStudyStep"
  ADD COLUMN IF NOT EXISTS "completionReflection" TEXT NOT NULL DEFAULT '';
