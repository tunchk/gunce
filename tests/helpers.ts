import { randomBytes } from "crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  createPairingInvitation,
  redeemPairingInvitation,
  revokeChildSessions,
  upsertChildDuringOnboarding,
  ensureParentFamily,
} from "@/lib/family";

export async function createParent(input?: {
  email?: string;
  name?: string;
  password?: string;
}) {
  const email = input?.email ?? `parent_${randomBytes(4).toString("hex")}@example.com`;
  const password = input?.password ?? "Password123!";
  const name = input?.name ?? "Test Veli";

  const user = await prisma.user.create({
    data: {
      name,
      email,
      emailVerified: false,
      role: "PARENT",
    },
  });

  await prisma.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await hashPassword(password),
    },
  });

  return { user, email, password };
}

export async function signInAndGetCookie(email: string, password: string) {
  const response = (await auth.api.signInEmail({
    body: { email, password },
    headers: new Headers({
      origin: "http://localhost:3000",
      "content-type": "application/json",
    }),
    asResponse: true,
  })) as Response;

  if (!response.ok) {
    throw new Error(`sign-in failed: ${response.status}`);
  }

  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);

  const cookieHeader = cookies
    .map((c) => String(c).split(";")[0])
    .filter(Boolean)
    .join("; ");

  if (!cookieHeader) {
    throw new Error("sign-in returned no set-cookie");
  }

  return cookieHeader;
}

export async function onboardParentWithChild(parentUserId: string) {
  await ensureParentFamily(parentUserId);
  return upsertChildDuringOnboarding({
    parentUserId,
    displayName: "Deniz",
    ageGroup: "AGE_9_11",
    timeZone: "Europe/Istanbul",
  });
}

export async function pairChildAndGetCookie(parentUserId: string, childId: string) {
  const { token } = await createPairingInvitation({
    parentUserId,
    childId,
  });
  const redeem = await redeemPairingInvitation({
    token,
    requestHeaders: new Headers({ origin: "http://localhost:3000" }),
  });
  const setCookie = redeem.responseHeaders.get("set-cookie");
  if (!setCookie) throw new Error("no child cookie");
  const cookie = setCookie
    .split(/,(?=\s*[^;]+=)/)
    .map((part) => part.split(";")[0]!.trim())
    .filter(Boolean)
    .join("; ");

  await prisma.childProfile.update({
    where: { id: childId },
    data: { onboardingStep: "COMPLETE", avatarKey: "deniz" },
  });

  const membership = await prisma.familyMembership.findUnique({
    where: { userId: parentUserId },
  });
  if (membership) {
    await prisma.family.update({
      where: { id: membership.familyId },
      data: { onboardingStep: "COMPLETE" },
    });
  }

  return cookie;
}

export function request(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as import("next/server").NextRequest;
}

export { prisma, auth, createPairingInvitation, redeemPairingInvitation, revokeChildSessions };
