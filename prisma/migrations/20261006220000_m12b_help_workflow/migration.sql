-- CreateEnum
CREATE TYPE "HelpType" AS ENUM ('DO_TOGETHER', 'EXPLAIN', 'REVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "HelpRequestStatus" AS ENUM ('OPEN', 'OFFERED', 'ACCEPTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HelpOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "AppNotificationKind" ADD VALUE 'HELP_REQUEST_CREATED';
ALTER TYPE "AppNotificationKind" ADD VALUE 'HELP_OFFER_CREATED';
ALTER TYPE "AppNotificationKind" ADD VALUE 'HELP_OFFER_ACCEPTED';
ALTER TYPE "AppNotificationKind" ADD VALUE 'HELP_REQUEST_CANCELLED';
ALTER TYPE "AppNotificationKind" ADD VALUE 'HELP_SESSION_COMPLETED';

-- CreateTable
CREATE TABLE "HelpRequest" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "studyStepId" TEXT,
    "commitmentId" TEXT,
    "helpType" "HelpType" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "HelpRequestStatus" NOT NULL DEFAULT 'OPEN',
    "acceptedOfferId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpOffer" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "guardianUserId" TEXT NOT NULL,
    "proposedDate" DATE NOT NULL,
    "proposedTimeLocal" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "HelpOfferStatus" NOT NULL DEFAULT 'PENDING',
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HelpRequest_acceptedOfferId_key" ON "HelpRequest"("acceptedOfferId");

-- CreateIndex
CREATE INDEX "HelpRequest_childId_status_createdAt_idx" ON "HelpRequest"("childId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "HelpRequest_studyStepId_idx" ON "HelpRequest"("studyStepId");

-- CreateIndex
CREATE INDEX "HelpRequest_commitmentId_idx" ON "HelpRequest"("commitmentId");

-- CreateIndex
CREATE UNIQUE INDEX "HelpOffer_requestId_guardianUserId_key" ON "HelpOffer"("requestId", "guardianUserId");

-- CreateIndex
CREATE INDEX "HelpOffer_guardianUserId_status_idx" ON "HelpOffer"("guardianUserId", "status");

-- CreateIndex
CREATE INDEX "HelpOffer_requestId_status_idx" ON "HelpOffer"("requestId", "status");

-- CreateIndex
CREATE INDEX "HelpOffer_proposedDate_idx" ON "HelpOffer"("proposedDate");

-- AddForeignKey
ALTER TABLE "HelpRequest" ADD CONSTRAINT "HelpRequest_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpRequest" ADD CONSTRAINT "HelpRequest_studyStepId_fkey" FOREIGN KEY ("studyStepId") REFERENCES "PlanStudyStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpRequest" ADD CONSTRAINT "HelpRequest_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "PlanCommitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpOffer" ADD CONSTRAINT "HelpOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HelpRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpOffer" ADD CONSTRAINT "HelpOffer_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Accepted offer FK added after HelpOffer exists
ALTER TABLE "HelpRequest" ADD CONSTRAINT "HelpRequest_acceptedOfferId_fkey" FOREIGN KEY ("acceptedOfferId") REFERENCES "HelpOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
