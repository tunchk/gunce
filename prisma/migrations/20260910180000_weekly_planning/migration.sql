-- CreateEnum
CREATE TYPE "PlanCommitmentType" AS ENUM ('HOMEWORK', 'EXAM', 'COURSE');

-- CreateTable
CREATE TABLE "PlanCommitment" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "type" "PlanCommitmentType" NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "dueDate" DATE,
    "eventDate" DATE,
    "eventTimeLocal" TEXT,
    "completedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanStudyStep" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "plannedDate" DATE,
    "estimatedMinutes" INTEGER,
    "relatedCommitmentId" TEXT,
    "completedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanStudyStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanCommitment_clientRequestId_key" ON "PlanCommitment"("clientRequestId");
CREATE INDEX "PlanCommitment_childId_eventDate_idx" ON "PlanCommitment"("childId", "eventDate");
CREATE INDEX "PlanCommitment_childId_dueDate_idx" ON "PlanCommitment"("childId", "dueDate");
CREATE INDEX "PlanCommitment_childId_completedAt_idx" ON "PlanCommitment"("childId", "completedAt");

CREATE UNIQUE INDEX "PlanStudyStep_clientRequestId_key" ON "PlanStudyStep"("clientRequestId");
CREATE INDEX "PlanStudyStep_childId_plannedDate_idx" ON "PlanStudyStep"("childId", "plannedDate");
CREATE INDEX "PlanStudyStep_childId_completedAt_idx" ON "PlanStudyStep"("childId", "completedAt");
CREATE INDEX "PlanStudyStep_relatedCommitmentId_idx" ON "PlanStudyStep"("relatedCommitmentId");

-- AddForeignKey
ALTER TABLE "PlanCommitment" ADD CONSTRAINT "PlanCommitment_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanStudyStep" ADD CONSTRAINT "PlanStudyStep_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanStudyStep" ADD CONSTRAINT "PlanStudyStep_relatedCommitmentId_fkey" FOREIGN KEY ("relatedCommitmentId") REFERENCES "PlanCommitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
