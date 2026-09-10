-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISCARDED', 'STALE');

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN "originalBody" TEXT NOT NULL DEFAULT '';
ALTER TABLE "JournalEntry" ADD COLUMN "acceptedSummary" TEXT NOT NULL DEFAULT '';

-- Backfill: treat existing body as original writing when empty original.
UPDATE "JournalEntry" SET "originalBody" = "body" WHERE "originalBody" = '' AND "body" <> '';

-- CreateTable
CREATE TABLE "JournalTranscript" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalSuggestion" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "suggestedText" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JournalTranscript_entryId_createdAt_idx" ON "JournalTranscript"("entryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JournalSuggestion_requestId_key" ON "JournalSuggestion"("requestId");

-- CreateIndex
CREATE INDEX "JournalSuggestion_entryId_createdAt_idx" ON "JournalSuggestion"("entryId", "createdAt");

-- AddForeignKey
ALTER TABLE "JournalTranscript" ADD CONSTRAINT "JournalTranscript_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalSuggestion" ADD CONSTRAINT "JournalSuggestion_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
