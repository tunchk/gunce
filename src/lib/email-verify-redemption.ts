import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

/** Better Auth email-verification JWTs are not DB-backed. We store a hash so confirm is single-use. */
export function emailVerifyRedemptionId(token: string): string {
  const hash = createHash("sha256").update(token).digest("hex");
  return `email-verify:${hash}`;
}

export async function registerEmailVerifyRedemption(input: {
  token: string;
  userId: string;
  expiresAt: Date;
}): Promise<void> {
  const identifier = emailVerifyRedemptionId(input.token);
  // Replace any prior unused redemption for this exact token (idempotent send).
  await prisma.verification.deleteMany({ where: { identifier } });
  await prisma.verification.create({
    data: {
      identifier,
      value: input.userId,
      expiresAt: input.expiresAt,
    },
  });
}

/**
 * Atomically consume a one-time email-verify redemption.
 * Returns userId on success, null if missing/expired/already used.
 */
export async function consumeEmailVerifyRedemption(
  token: string,
): Promise<string | null> {
  const identifier = emailVerifyRedemptionId(token);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const row = await tx.verification.findFirst({
      where: { identifier },
    });
    if (!row || row.expiresAt < now) {
      if (row) {
        await tx.verification.deleteMany({ where: { id: row.id } });
      }
      return null;
    }
    const deleted = await tx.verification.deleteMany({
      where: { id: row.id },
    });
    if (deleted.count !== 1) return null;
    return row.value;
  });
}
