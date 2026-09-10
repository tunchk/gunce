-- AlterTable
ALTER TABLE "JournalTranscript" ADD COLUMN "segmentId" TEXT;
ALTER TABLE "JournalTranscript" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "JournalTranscript" ADD COLUMN "sessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "JournalTranscript_segmentId_key" ON "JournalTranscript"("segmentId");

-- CreateIndex
CREATE INDEX "JournalTranscript_entryId_sessionId_sequence_idx" ON "JournalTranscript"("entryId", "sessionId", "sequence");
