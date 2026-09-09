-- CreateEnum
CREATE TYPE "JournalPrompt" AS ENUM ('LIKED', 'HARD', 'LEARNED', 'TODO', 'FREE');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'SAVED');

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "promptKey" "JournalPrompt",
    "diaryDate" DATE NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharingDraft" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "parentMessage" TEXT NOT NULL DEFAULT '',
    "supportRequest" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishedShare" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "parentMessage" TEXT NOT NULL DEFAULT '',
    "supportRequest" TEXT NOT NULL DEFAULT '',
    "sourceDraftRevision" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "PublishedShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_clientRequestId_key" ON "JournalEntry"("clientRequestId");

-- CreateIndex
CREATE INDEX "JournalEntry_childId_diaryDate_idx" ON "JournalEntry"("childId", "diaryDate");

-- CreateIndex
CREATE INDEX "JournalEntry_childId_updatedAt_idx" ON "JournalEntry"("childId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SharingDraft_entryId_key" ON "SharingDraft"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedShare_entryId_key" ON "PublishedShare"("entryId");

-- CreateIndex
CREATE INDEX "PublishedShare_familyId_withdrawnAt_publishedAt_idx" ON "PublishedShare"("familyId", "withdrawnAt", "publishedAt");

-- CreateIndex
CREATE INDEX "PublishedShare_childId_withdrawnAt_idx" ON "PublishedShare"("childId", "withdrawnAt");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharingDraft" ADD CONSTRAINT "SharingDraft_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedShare" ADD CONSTRAINT "PublishedShare_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedShare" ADD CONSTRAINT "PublishedShare_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
