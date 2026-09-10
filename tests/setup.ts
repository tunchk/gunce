import { beforeAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";

const DEFAULT_TEST_URL =
  "postgresql://gunce:gunce@localhost:5432/gunce_test?schema=public";

/**
 * Tests may only touch `gunce_test`. Refuse anything else so `beforeEach`
 * wipe queries cannot destroy the development database `gunce`.
 */
function assertSafeTestDatabaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `[tests] DATABASE_URL is not a valid URL. Refusing to run. Got: ${url}`,
    );
  }

  const dbName = parsed.pathname.replace(/^\//, "").split("/")[0] || "";
  if (dbName !== "gunce_test") {
    throw new Error(
      `[tests] Refusing to run against database "${dbName || "(empty)"}". ` +
        `Integration tests must use only "gunce_test" (got DATABASE_URL=${url}). ` +
        `Development database "gunce" must never be reset by tests.`,
    );
  }
}

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || DEFAULT_TEST_URL;
assertSafeTestDatabaseUrl(process.env.DATABASE_URL);

process.env.BETTER_AUTH_SECRET = "test-secret-please-change-32chars!!";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

beforeAll(() => {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL!);
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
});

beforeEach(async () => {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL!);
  const { prisma } = await import("../src/lib/prisma");

  // Defense in depth: confirm the live connection is still gunce_test.
  const rows = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  const liveDb = rows[0]?.db;
  if (liveDb !== "gunce_test") {
    throw new Error(
      `[tests] Connected to "${liveDb}" instead of "gunce_test". Aborting before any deletes.`,
    );
  }

  await prisma.parentGuidance.deleteMany();
  await prisma.journalSuggestion.deleteMany();
  await prisma.journalTranscript.deleteMany();
  await prisma.publishedShare.deleteMany();
  await prisma.sharingDraft.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.rateLimitBucket.deleteMany();
  await prisma.pairingInvitation.deleteMany();
  await prisma.childProfile.deleteMany();
  await prisma.familyMembership.deleteMany();
  await prisma.family.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.user.deleteMany();
});
