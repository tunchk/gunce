import { hashPassword } from "better-auth/crypto";
import type { AgeGroup, ChildOnboardingStep, ParentOnboardingStep } from "@prisma/client";
import { auth } from "@/lib/auth";
import {
  childSyntheticEmail,
  generateChildPassword,
  generatePairingToken,
  hashToken,
} from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/lib/session";

const PAIRING_TTL_MS = 30 * 60 * 1000;

export class PairingError extends Error {
  constructor(
    message: string,
    public code:
      | "NOT_FOUND"
      | "EXPIRED"
      | "REDEEMED"
      | "REVOKED"
      | "RATE_LIMIT"
      | "CONFLICT",
  ) {
    super(message);
    this.name = "PairingError";
  }
}

export async function ensureParentFamily(parentUserId: string) {
  const existing = await prisma.familyMembership.findUnique({
    where: { userId: parentUserId },
    include: { family: { include: { children: true } } },
  });

  if (existing) {
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const again = await tx.familyMembership.findUnique({
      where: { userId: parentUserId },
      include: { family: { include: { children: true } } },
    });
    if (again) return again;

    const family = await tx.family.create({
      data: {
        onboardingStep: "CHILD_PROFILE",
        members: {
          create: { userId: parentUserId },
        },
      },
      include: { children: true },
    });

    const membership = await tx.familyMembership.findUniqueOrThrow({
      where: { userId: parentUserId },
      include: { family: { include: { children: true } } },
    });

    void family;
    return membership;
  });
}

export async function upsertChildDuringOnboarding(input: {
  parentUserId: string;
  displayName: string;
  ageGroup: AgeGroup;
  timeZone: string;
}) {
  const membership = await ensureParentFamily(input.parentUserId);
  const existingChild = membership.family.children[0];

  if (existingChild) {
    const child = await prisma.childProfile.update({
      where: { id: existingChild.id },
      data: {
        displayName: input.displayName,
        ageGroup: input.ageGroup,
        timeZone: input.timeZone,
      },
    });

    if (membership.family.onboardingStep === "CHILD_PROFILE") {
      await prisma.family.update({
        where: { id: membership.familyId },
        data: { onboardingStep: "EXPLANATION" },
      });
    }

    return child;
  }

  const child = await prisma.childProfile.create({
    data: {
      familyId: membership.familyId,
      displayName: input.displayName,
      ageGroup: input.ageGroup,
      timeZone: input.timeZone,
    },
  });

  await prisma.family.update({
    where: { id: membership.familyId },
    data: { onboardingStep: "EXPLANATION" },
  });

  return child;
}

export async function advanceParentOnboarding(
  parentUserId: string,
  step: ParentOnboardingStep,
) {
  const membership = await prisma.familyMembership.findUnique({
    where: { userId: parentUserId },
  });
  if (!membership) {
    throw new AuthorizationError("Aile bulunamadı.");
  }

  await prisma.family.update({
    where: { id: membership.familyId },
    data: { onboardingStep: step },
  });
}

export async function createPairingInvitation(input: {
  parentUserId: string;
  childId: string;
}) {
  const membership = await prisma.familyMembership.findUnique({
    where: { userId: input.parentUserId },
  });
  if (!membership) {
    throw new AuthorizationError("Aile bulunamadı.");
  }

  const child = await prisma.childProfile.findFirst({
    where: { id: input.childId, familyId: membership.familyId },
  });
  if (!child) {
    throw new AuthorizationError("Bu çocuğa erişimin yok.");
  }

  await prisma.pairingInvitation.updateMany({
    where: {
      childId: child.id,
      redeemedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { revokedAt: new Date() },
  });

  const token = generatePairingToken();
  const invitation = await prisma.pairingInvitation.create({
    data: {
      childId: child.id,
      createdByUserId: input.parentUserId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PAIRING_TTL_MS),
    },
  });

  if (
    (await prisma.family.findUniqueOrThrow({ where: { id: membership.familyId } }))
      .onboardingStep !== "COMPLETE"
  ) {
    await prisma.family.update({
      where: { id: membership.familyId },
      data: { onboardingStep: "PAIRING" },
    });
  }

  return { invitation, token };
}

export async function redeemPairingInvitation(input: {
  token: string;
  requestHeaders: Headers;
}): Promise<{ childId: string; responseHeaders: Headers }> {
  const tokenHash = hashToken(input.token);
  const now = new Date();

  const invitation = await prisma.pairingInvitation.findUnique({
    where: { tokenHash },
    include: { child: true },
  });

  if (!invitation) {
    throw new PairingError("Davet bulunamadı.", "NOT_FOUND");
  }
  if (invitation.revokedAt) {
    throw new PairingError("Bu davet iptal edildi.", "REVOKED");
  }
  if (invitation.redeemedAt) {
    throw new PairingError("Bu davet daha önce kullanıldı.", "REDEEMED");
  }
  if (invitation.expiresAt.getTime() <= now.getTime()) {
    throw new PairingError("Bu davetin süresi dolmuş.", "EXPIRED");
  }

  const redeemed = await prisma.pairingInvitation.updateMany({
    where: {
      id: invitation.id,
      redeemedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { redeemedAt: now },
  });

  if (redeemed.count !== 1) {
    const latest = await prisma.pairingInvitation.findUnique({
      where: { id: invitation.id },
    });
    if (latest?.revokedAt) {
      throw new PairingError("Bu davet iptal edildi.", "REVOKED");
    }
    if (latest?.redeemedAt) {
      throw new PairingError("Bu davet daha önce kullanıldı.", "REDEEMED");
    }
    if (latest && latest.expiresAt.getTime() <= Date.now()) {
      throw new PairingError("Bu davetin süresi dolmuş.", "EXPIRED");
    }
    throw new PairingError("Davet kullanılamadı.", "CONFLICT");
  }

  const child = invitation.child;
  const email = childSyntheticEmail(child.id);
  const password = generateChildPassword();
  const passwordHash = await hashPassword(password);

  let userId = child.userId;
  if (!userId) {
    const user = await prisma.user.create({
      data: {
        name: child.displayName,
        email,
        emailVerified: false,
        role: "CHILD",
      },
    });
    userId = user.id;
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
      },
    });
    await prisma.childProfile.update({
      where: { id: child.id },
      data: { userId },
    });
  } else {
    await prisma.account.updateMany({
      where: { userId, providerId: "credential" },
      data: { password: passwordHash, accountId: userId },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { name: child.displayName },
    });
  }

  const baseURL = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Clear any existing browser session (parent on shared device).
  try {
    await auth.api.signOut({
      headers: input.requestHeaders,
      asResponse: true,
    });
  } catch {
    // No existing session is fine.
  }

  const cleanHeaders = new Headers(input.requestHeaders);
  cleanHeaders.delete("cookie");
  cleanHeaders.set("origin", baseURL);
  cleanHeaders.set("content-type", "application/json");

  const signIn = (await auth.api.signInEmail({
    body: { email, password },
    headers: cleanHeaders,
    asResponse: true,
  })) as Response;

  if (!signIn.ok) {
    throw new PairingError("Oturum oluşturulamadı.", "CONFLICT");
  }

  const responseHeaders = new Headers();
  const setCookies =
    typeof signIn.headers.getSetCookie === "function" ? signIn.headers.getSetCookie() : [];

  if (setCookies.length > 0) {
    for (const cookie of setCookies) {
      responseHeaders.append("set-cookie", cookie);
    }
  } else {
    const single = signIn.headers.get("set-cookie");
    if (single) responseHeaders.append("set-cookie", single);
  }

  return { childId: child.id, responseHeaders };
}

export async function revokeChildSessions(input: {
  parentUserId: string;
  childId: string;
}) {
  const membership = await prisma.familyMembership.findUnique({
    where: { userId: input.parentUserId },
  });
  if (!membership) {
    throw new AuthorizationError("Aile bulunamadı.");
  }

  const child = await prisma.childProfile.findFirst({
    where: { id: input.childId, familyId: membership.familyId },
  });
  if (!child) {
    throw new AuthorizationError("Bu çocuğa erişimin yok.");
  }

  await prisma.pairingInvitation.updateMany({
    where: {
      childId: child.id,
      redeemedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  if (child.userId) {
    await prisma.session.deleteMany({
      where: { userId: child.userId },
    });
    const { revokePushSubscriptionsForChild } = await import("@/lib/reminder");
    await revokePushSubscriptionsForChild(child.id);
  }

  return { ok: true as const };
}

export async function updateChildOnboarding(input: {
  childUserId: string;
  step?: ChildOnboardingStep;
  avatarKey?: string;
}) {
  const child = await prisma.childProfile.findUnique({
    where: { userId: input.childUserId },
  });
  if (!child) {
    throw new AuthorizationError("Çocuk profili bulunamadı.");
  }

  return prisma.childProfile.update({
    where: { id: child.id },
    data: {
      ...(input.avatarKey !== undefined ? { avatarKey: input.avatarKey } : {}),
      ...(input.step !== undefined ? { onboardingStep: input.step } : {}),
    },
  });
}

export async function markParentOnboardingComplete(parentUserId: string) {
  const membership = await prisma.familyMembership.findUnique({
    where: { userId: parentUserId },
  });
  if (!membership) return;
  await prisma.family.update({
    where: { id: membership.familyId },
    data: { onboardingStep: "COMPLETE" },
  });
}
