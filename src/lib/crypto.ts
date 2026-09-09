import { createHash, randomBytes, timingSafeEqual } from "crypto";

export function generatePairingToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateChildPassword(): string {
  return randomBytes(32).toString("base64url");
}

export function childSyntheticEmail(childProfileId: string): string {
  return `child_${childProfileId}@users.gunce.local`;
}

export function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
