-- M13 Family Coordination Calendar
CREATE TYPE "FamilyEventType" AS ENUM ('SCHOOL', 'APPOINTMENT', 'FAMILY', 'ACTIVITY', 'OTHER');

ALTER TYPE "AppNotificationKind" ADD VALUE 'FAMILY_EVENT_CREATED';
ALTER TYPE "AppNotificationKind" ADD VALUE 'FAMILY_EVENT_UPDATED';
ALTER TYPE "AppNotificationKind" ADD VALUE 'FAMILY_EVENT_CANCELLED';

CREATE TABLE "FamilyEvent" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "eventDate" DATE NOT NULL,
    "startTimeLocal" TEXT,
    "endTimeLocal" TEXT,
    "eventType" "FamilyEventType" NOT NULL DEFAULT 'OTHER',
    "note" TEXT NOT NULL DEFAULT '',
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FamilyEvent_childId_eventDate_idx" ON "FamilyEvent"("childId", "eventDate");
CREATE INDEX "FamilyEvent_childId_cancelledAt_idx" ON "FamilyEvent"("childId", "cancelledAt");
CREATE INDEX "FamilyEvent_createdByUserId_idx" ON "FamilyEvent"("createdByUserId");

ALTER TABLE "FamilyEvent" ADD CONSTRAINT "FamilyEvent_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyEvent" ADD CONSTRAINT "FamilyEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
