-- CreateEnum
CREATE TYPE "PlanExtractBatchStatus" AS ENUM ('READY', 'STALE', 'APPLIED');

-- CreateEnum
CREATE TYPE "PlanExtractCandidateType" AS ENUM ('HOMEWORK', 'EXAM', 'COURSE', 'STUDY_STEP');

-- CreateEnum
CREATE TYPE "PlanExtractMentionKind" AS ENUM ('EXPLICIT', 'PREPARATION');

-- CreateEnum
CREATE TYPE "PlanExtractCandidateStatus" AS ENUM ('PENDING', 'APPLIED', 'SKIPPED');

-- CreateTable
CREATE TABLE "PlanExtractBatch" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "diaryDate" DATE NOT NULL,
    "status" "PlanExtractBatchStatus" NOT NULL DEFAULT 'READY',
    "provider" TEXT NOT NULL DEFAULT '',
    "applyRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanExtractBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanExtractCandidate" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "type" "PlanExtractCandidateType" NOT NULL,
    "mentionKind" "PlanExtractMentionKind" NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "sourceExcerpt" TEXT NOT NULL,
    "datePhrase" TEXT NOT NULL DEFAULT '',
    "proposedDate" DATE,
    "dateUncertain" BOOLEAN NOT NULL DEFAULT false,
    "estimatedMinutes" INTEGER,
    "relatedCandidateOrdinal" INTEGER,
    "status" "PlanExtractCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "appliedCommitmentId" TEXT,
    "appliedStudyStepId" TEXT,
    "applyClientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanExtractCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanExtractBatch_requestId_key" ON "PlanExtractBatch"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanExtractBatch_applyRequestId_key" ON "PlanExtractBatch"("applyRequestId");

-- CreateIndex
CREATE INDEX "PlanExtractBatch_entryId_createdAt_idx" ON "PlanExtractBatch"("entryId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanExtractBatch_childId_createdAt_idx" ON "PlanExtractBatch"("childId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanExtractCandidate_applyClientRequestId_key" ON "PlanExtractCandidate"("applyClientRequestId");

-- CreateIndex
CREATE INDEX "PlanExtractCandidate_batchId_idx" ON "PlanExtractCandidate"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanExtractCandidate_batchId_ordinal_key" ON "PlanExtractCandidate"("batchId", "ordinal");

-- AddForeignKey
ALTER TABLE "PlanExtractBatch" ADD CONSTRAINT "PlanExtractBatch_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExtractBatch" ADD CONSTRAINT "PlanExtractBatch_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExtractCandidate" ADD CONSTRAINT "PlanExtractCandidate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PlanExtractBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
