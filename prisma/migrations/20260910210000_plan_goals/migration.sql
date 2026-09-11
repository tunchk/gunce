-- CreateEnum
CREATE TYPE "PlanGoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "PlanGoal" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "targetDate" DATE,
    "status" "PlanGoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanGoal_pkey" PRIMARY KEY ("id")
);

-- AlterTable: optional goal link on existing study steps
ALTER TABLE "PlanStudyStep" ADD COLUMN "relatedGoalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PlanGoal_clientRequestId_key" ON "PlanGoal"("clientRequestId");
CREATE INDEX "PlanGoal_childId_status_idx" ON "PlanGoal"("childId", "status");
CREATE INDEX "PlanGoal_childId_targetDate_idx" ON "PlanGoal"("childId", "targetDate");
CREATE INDEX "PlanStudyStep_relatedGoalId_idx" ON "PlanStudyStep"("relatedGoalId");

-- AddForeignKey
ALTER TABLE "PlanGoal" ADD CONSTRAINT "PlanGoal_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanStudyStep" ADD CONSTRAINT "PlanStudyStep_relatedGoalId_fkey" FOREIGN KEY ("relatedGoalId") REFERENCES "PlanGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
