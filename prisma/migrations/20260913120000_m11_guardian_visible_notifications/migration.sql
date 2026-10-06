-- Milestone 11: direct guardian visibility + in-app notification center

CREATE TYPE "JournalVisibility" AS ENUM ('LEGACY_PRIVATE', 'GUARDIAN_VISIBLE');
CREATE TYPE "AppNotificationKind" AS ENUM (
  'JOURNAL_GUARDIAN_VISIBLE',
  'LEGACY_SHARE_PUBLISHED',
  'REMINDER_JOURNAL',
  'REMINDER_STUDY_STEP'
);
CREATE TYPE "JournalAiJobStatus" AS ENUM (
  'PENDING',
  'CLAIMED',
  'DONE',
  'FAILED',
  'CANCELLED'
);
CREATE TYPE "JournalGuardianAiStatus" AS ENUM (
  'PENDING',
  'READY',
  'FAILED',
  'STALE'
);

-- Existing rows stay private under the prior product promise.
ALTER TABLE "JournalEntry"
  ADD COLUMN "visibility" "JournalVisibility" NOT NULL DEFAULT 'LEGACY_PRIVATE',
  ADD COLUMN "firstNotifiedAt" TIMESTAMP(3);

ALTER TABLE "JournalEntry"
  ALTER COLUMN "visibility" SET DEFAULT 'GUARDIAN_VISIBLE';

CREATE TABLE "JournalGuardianAi" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "status" "JournalGuardianAiStatus" NOT NULL DEFAULT 'PENDING',
  "summaryText" TEXT NOT NULL DEFAULT '',
  "conversationOpener" TEXT NOT NULL DEFAULT '',
  "supportAction" TEXT NOT NULL DEFAULT '',
  "provider" TEXT NOT NULL DEFAULT '',
  "lastError" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JournalGuardianAi_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JournalGuardianAi_entryId_key" ON "JournalGuardianAi"("entryId");

CREATE TABLE "JournalAiJob" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "status" "JournalAiJobStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "claimToken" TEXT,
  "claimedAt" TIMESTAMP(3),
  "claimExpiresAt" TIMESTAMP(3),
  "lastError" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JournalAiJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JournalAiJob_entryId_sourceRevision_key" ON "JournalAiJob"("entryId", "sourceRevision");
CREATE INDEX "JournalAiJob_status_createdAt_idx" ON "JournalAiJob"("status", "createdAt");
CREATE INDEX "JournalAiJob_claimExpiresAt_idx" ON "JournalAiJob"("claimExpiresAt");

CREATE TABLE "AppNotification" (
  "id" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "kind" "AppNotificationKind" NOT NULL,
  "uniquenessKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "href" TEXT NOT NULL,
  "childId" TEXT,
  "entryId" TEXT,
  "shareId" TEXT,
  "reminderOccurrenceId" TEXT,
  "readAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AppNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppNotification_uniquenessKey_key" ON "AppNotification"("uniquenessKey");
CREATE INDEX "AppNotification_recipientUserId_invalidatedAt_createdAt_idx"
  ON "AppNotification"("recipientUserId", "invalidatedAt", "createdAt");
CREATE INDEX "AppNotification_recipientUserId_readAt_invalidatedAt_idx"
  ON "AppNotification"("recipientUserId", "readAt", "invalidatedAt");
CREATE INDEX "AppNotification_entryId_idx" ON "AppNotification"("entryId");
CREATE INDEX "AppNotification_shareId_idx" ON "AppNotification"("shareId");
CREATE INDEX "AppNotification_childId_recipientUserId_idx"
  ON "AppNotification"("childId", "recipientUserId");

CREATE INDEX "JournalEntry_childId_visibility_updatedAt_idx"
  ON "JournalEntry"("childId", "visibility", "updatedAt");

ALTER TABLE "JournalGuardianAi"
  ADD CONSTRAINT "JournalGuardianAi_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JournalAiJob"
  ADD CONSTRAINT "JournalAiJob_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppNotification"
  ADD CONSTRAINT "AppNotification_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppNotification"
  ADD CONSTRAINT "AppNotification_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
