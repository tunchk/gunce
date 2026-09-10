-- CreateTable
CREATE TABLE "ParentGuidance" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "snapshotRevision" INTEGER NOT NULL,
    "conversationOpener" TEXT NOT NULL,
    "supportAction" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentGuidance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParentGuidance_shareId_key" ON "ParentGuidance"("shareId");

-- AddForeignKey
ALTER TABLE "ParentGuidance" ADD CONSTRAINT "ParentGuidance_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "PublishedShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
