-- Milestone 10: multi-guardian access + explicit share audiences

CREATE TYPE "GuardianRole" AS ENUM ('MANAGER', 'INVITED');

CREATE TABLE "ChildGuardianAccess" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "GuardianRole" NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ChildGuardianAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuardianInvitation" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublishedShareRecipient" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "guardianUserId" TEXT NOT NULL,
    "accessGeneration" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishedShareRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChildGuardianAccess_userId_revokedAt_idx" ON "ChildGuardianAccess"("userId", "revokedAt");
CREATE INDEX "ChildGuardianAccess_childId_revokedAt_idx" ON "ChildGuardianAccess"("childId", "revokedAt");
CREATE INDEX "ChildGuardianAccess_childId_userId_idx" ON "ChildGuardianAccess"("childId", "userId");

CREATE UNIQUE INDEX "GuardianInvitation_tokenHash_key" ON "GuardianInvitation"("tokenHash");
CREATE INDEX "GuardianInvitation_childId_idx" ON "GuardianInvitation"("childId");
CREATE INDEX "GuardianInvitation_email_idx" ON "GuardianInvitation"("email");
CREATE INDEX "GuardianInvitation_expiresAt_idx" ON "GuardianInvitation"("expiresAt");

CREATE UNIQUE INDEX "PublishedShareRecipient_shareId_guardianUserId_key" ON "PublishedShareRecipient"("shareId", "guardianUserId");
CREATE INDEX "PublishedShareRecipient_guardianUserId_idx" ON "PublishedShareRecipient"("guardianUserId");
CREATE INDEX "PublishedShareRecipient_shareId_idx" ON "PublishedShareRecipient"("shareId");

ALTER TABLE "ChildGuardianAccess" ADD CONSTRAINT "ChildGuardianAccess_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChildGuardianAccess" ADD CONSTRAINT "ChildGuardianAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuardianInvitation" ADD CONSTRAINT "GuardianInvitation_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuardianInvitation" ADD CONSTRAINT "GuardianInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PublishedShareRecipient" ADD CONSTRAINT "PublishedShareRecipient_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "PublishedShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublishedShareRecipient" ADD CONSTRAINT "PublishedShareRecipient_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: pre-M10 authz was FamilyMembership → all children in that family.
-- Each membership user becomes MANAGER for every child in their family (generation 1).
INSERT INTO "ChildGuardianAccess" ("id", "childId", "userId", "role", "generation", "createdAt", "revokedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || c."id" || m."userId"),
  c."id",
  m."userId",
  'MANAGER'::"GuardianRole",
  1,
  CURRENT_TIMESTAMP,
  NULL
FROM "ChildProfile" c
INNER JOIN "FamilyMembership" m ON m."familyId" = c."familyId"
WHERE NOT EXISTS (
  SELECT 1 FROM "ChildGuardianAccess" a
  WHERE a."childId" = c."id" AND a."userId" = m."userId" AND a."revokedAt" IS NULL
);

-- Historical shares: recipients = family members who had family-scoped access (generation 1).
INSERT INTO "PublishedShareRecipient" ("id", "shareId", "guardianUserId", "accessGeneration", "createdAt")
SELECT
  md5(random()::text || clock_timestamp()::text || s."id" || m."userId"),
  s."id",
  m."userId",
  1,
  CURRENT_TIMESTAMP
FROM "PublishedShare" s
INNER JOIN "FamilyMembership" m ON m."familyId" = s."familyId"
WHERE NOT EXISTS (
  SELECT 1 FROM "PublishedShareRecipient" r
  WHERE r."shareId" = s."id" AND r."guardianUserId" = m."userId"
);
