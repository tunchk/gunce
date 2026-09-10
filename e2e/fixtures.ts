/**
 * E2E helpers. Keep Playwright `test` imports inside spec files only so Vitest
 * does not load Playwright's test runner when scanning the repo.
 */
import { execSync } from "node:child_process";

const PORT = Number(process.env.E2E_PORT || 3100);
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ||
  "e2e-secret-please-change-32chars!!";

const TEST_DB =
  process.env.DATABASE_URL_TEST ||
  "postgresql://gunce:gunce@localhost:5432/gunce_test?schema=public";

// Ensure both Playwright test runner + app server use the same config.
process.env.DATABASE_URL = TEST_DB;
process.env.DATABASE_URL_TEST = TEST_DB;
process.env.BETTER_AUTH_SECRET = BETTER_AUTH_SECRET;
process.env.BETTER_AUTH_URL = baseURL;
process.env.NEXT_PUBLIC_APP_URL = baseURL;

export function assertTestDb() {
  const db = new URL(TEST_DB).pathname.replace(/^\//, "").split("/")[0];
  if (db !== "gunce_test") {
    throw new Error(`E2E must use gunce_test, got ${db}`);
  }
  if (!process.env.DATABASE_URL?.includes("gunce_test")) {
    throw new Error(
      `[e2e] DATABASE_URL must point to gunce_test. Got ${process.env.DATABASE_URL}`,
    );
  }
}

export async function wipe() {
  assertTestDb();
  const { prisma } = await import("../tests/helpers");

  const rows = await prisma.$queryRaw<Array<{ db: string }>>`
    SELECT current_database() AS db
  `;
  if (rows[0]?.db !== "gunce_test") {
    throw new Error(`Refuse wipe on ${rows[0]?.db}`);
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
}

export function parseCookieHeader(header: string) {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...rest] = part.split("=");
      return {
        name: name!,
        value: rest.join("="),
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      };
    });
}

assertTestDb();
execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: TEST_DB },
});

export {
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  prisma,
  signInAndGetCookie,
} from "../tests/helpers";

export {
  createJournalEntry,
  publishShare,
  updateSharingDraft,
  withdrawShare,
} from "../src/lib/journal";
