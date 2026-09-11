-- AlterTable
ALTER TABLE "PlanStudyStep" ADD COLUMN "reminderLocalTime" TEXT;

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('JOURNAL', 'STUDY_STEP');

-- CreateEnum
CREATE TYPE "ReminderOccurrenceStatus" AS ENUM ('PENDING', 'CLAIMED', 'SENT', 'SKIPPED', 'CANCELLED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ChildReminderPreferences" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "journalReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "journalReminderLocalTime" TEXT NOT NULL DEFAULT '19:00',
    "studyRemindersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" TEXT NOT NULL DEFAULT '21:00',
    "quietHoursEnd" TEXT NOT NULL DEFAULT '08:00',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildReminderPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildPushSubscription" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildPushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderOccurrence" (
    "id" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "studyStepId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "effectiveLocalDate" DATE NOT NULL,
    "status" "ReminderOccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "scheduleRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderDelivery" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderDayBucket" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderDayBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChildReminderPreferences_childId_key" ON "ChildReminderPreferences"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "ChildPushSubscription_endpoint_key" ON "ChildPushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "ChildPushSubscription_childId_revokedAt_idx" ON "ChildPushSubscription"("childId", "revokedAt");

-- CreateIndex
CREATE INDEX "ChildPushSubscription_userId_idx" ON "ChildPushSubscription"("userId");

-- CreateIndex
CREATE INDEX "ChildPushSubscription_sessionId_idx" ON "ChildPushSubscription"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderOccurrence_occurrenceKey_key" ON "ReminderOccurrence"("occurrenceKey");

-- CreateIndex
CREATE INDEX "ReminderOccurrence_status_scheduledAt_idx" ON "ReminderOccurrence"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ReminderOccurrence_childId_effectiveLocalDate_idx" ON "ReminderOccurrence"("childId", "effectiveLocalDate");

-- CreateIndex
CREATE INDEX "ReminderOccurrence_studyStepId_idx" ON "ReminderOccurrence"("studyStepId");

-- CreateIndex
CREATE INDEX "ReminderOccurrence_claimExpiresAt_idx" ON "ReminderOccurrence"("claimExpiresAt");

-- CreateIndex
CREATE INDEX "ReminderDelivery_subscriptionId_idx" ON "ReminderDelivery"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDelivery_occurrenceId_subscriptionId_key" ON "ReminderDelivery"("occurrenceId", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDayBucket_childId_localDate_key" ON "ReminderDayBucket"("childId", "localDate");

-- AddForeignKey
ALTER TABLE "ChildReminderPreferences" ADD CONSTRAINT "ChildReminderPreferences_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildPushSubscription" ADD CONSTRAINT "ChildPushSubscription_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderOccurrence" ADD CONSTRAINT "ReminderOccurrence_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderOccurrence" ADD CONSTRAINT "ReminderOccurrence_studyStepId_fkey" FOREIGN KEY ("studyStepId") REFERENCES "PlanStudyStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "ReminderOccurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ChildPushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDayBucket" ADD CONSTRAINT "ReminderDayBucket_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
