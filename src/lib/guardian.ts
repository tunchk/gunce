import type { GuardianRole } from "@prisma/client";
import { getAppOrigin } from "@/lib/app-origin";
import { generatePairingToken, hashToken } from "@/lib/crypto";
import { isMailDeliveryAvailable, reportMailFailure, sendMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/lib/session";

const GUARDIAN_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class GuardianError extends Error {
  constructor(
    message: string,
    public code:
      | "NOT_FOUND"
      | "EXPIRED"
      | "REDEEMED"
      | "REVOKED"
      | "FORBIDDEN"
      | "EMAIL_MISMATCH"
      | "UNVERIFIED"
      | "DUPLICATE"
      | "LAST_MANAGER"
      | "CONFLICT"
      | "MAIL"
      | "INVITER_LOST_AUTH",
  ) {
    super(message);
    this.name = "GuardianError";
  }
}

export type ActiveGuardianAccess = {
  id: string;
  childId: string;
  userId: string;
  role: GuardianRole;
  generation: number;
};

export function normalizeGuardianEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getActiveGuardianAccess(
  userId: string,
  childId: string,
): Promise<ActiveGuardianAccess | null> {
  const row = await prisma.childGuardianAccess.findFirst({
    where: { userId, childId, revokedAt: null },
    orderBy: { generation: "desc" },
  });
  if (!row) return null;
  return {
    id: row.id,
    childId: row.childId,
    userId: row.userId,
    role: row.role,
    generation: row.generation,
  };
}

export async function listActiveGuardianAccesses(userId: string) {
  return prisma.childGuardianAccess.findMany({
    where: { userId, revokedAt: null },
    include: {
      child: {
        select: {
          id: true,
          displayName: true,
          familyId: true,
          ageGroup: true,
          timeZone: true,
          avatarKey: true,
          userId: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function requireGuardianAccess(
  userId: string,
  childId: string,
): Promise<ActiveGuardianAccess> {
  const access = await getActiveGuardianAccess(userId, childId);
  if (!access) throw new AuthorizationError("Bu çocuğa erişimin yok.");
  return access;
}

export async function requireManagerAccess(
  userId: string,
  childId: string,
): Promise<ActiveGuardianAccess> {
  const access = await requireGuardianAccess(userId, childId);
  if (access.role !== "MANAGER") {
    throw new AuthorizationError("Bu işlem yalnızca yönetici veli için.");
  }
  return access;
}

/** Grant MANAGER when a parent creates/owns a child during onboarding. Idempotent. */
export async function ensureManagerAccessForChild(input: {
  parentUserId: string;
  childId: string;
}) {
  const existing = await getActiveGuardianAccess(input.parentUserId, input.childId);
  if (existing) {
    if (existing.role !== "MANAGER") {
      await prisma.childGuardianAccess.update({
        where: { id: existing.id },
        data: { role: "MANAGER" },
      });
    }
    return;
  }
  await prisma.childGuardianAccess.create({
    data: {
      childId: input.childId,
      userId: input.parentUserId,
      role: "MANAGER",
      generation: 1,
    },
  });
}

export async function listChildGuardians(childId: string) {
  return prisma.childGuardianAccess.findMany({
    where: { childId, revokedAt: null },
    include: {
      user: { select: { id: true, name: true, email: true, emailVerified: true } },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
}

export async function listPendingGuardianInvitations(childId: string) {
  const now = new Date();
  return prisma.guardianInvitation.findMany({
    where: {
      childId,
      redeemedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function inviteGuardian(input: {
  managerUserId: string;
  childId: string;
  email: string;
}) {
  const manager = await prisma.user.findUniqueOrThrow({
    where: { id: input.managerUserId },
  });
  if (!manager.emailVerified) {
    throw new GuardianError(
      "Veli daveti göndermek için e-posta adresini doğrulaman gerekir.",
      "UNVERIFIED",
    );
  }

  await requireManagerAccess(input.managerUserId, input.childId);

  const email = normalizeGuardianEmail(input.email);
  if (email === normalizeGuardianEmail(manager.email)) {
    throw new GuardianError("Kendini davet edemezsin.", "DUPLICATE");
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const active = await getActiveGuardianAccess(existingUser.id, input.childId);
    if (active) {
      throw new GuardianError("Bu veli zaten bu çocuğa erişiyor.", "DUPLICATE");
    }
  }

  if (!isMailDeliveryAvailable()) {
    throw new GuardianError("E-posta gönderimi şu an yapılamıyor.", "MAIL");
  }

  const child = await prisma.childProfile.findUniqueOrThrow({
    where: { id: input.childId },
    select: { displayName: true },
  });

  // Revoke other pending invites to the same email for this child.
  await prisma.guardianInvitation.updateMany({
    where: {
      childId: input.childId,
      email,
      redeemedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  const token = generatePairingToken();
  const invitation = await prisma.guardianInvitation.create({
    data: {
      childId: input.childId,
      email,
      invitedByUserId: input.managerUserId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + GUARDIAN_INVITE_TTL_MS),
    },
  });

  const origin = getAppOrigin();
  const link = `${origin}/veli/davet?token=${encodeURIComponent(token)}`;

  try {
    await sendMail({
      to: email,
      subject: "Günce — veli daveti",
      text: [
        "Merhaba,",
        "",
        `${manager.name} seni Günce’de “${child.displayName}” için veli olarak davet etti.`,
        "Bu davet uygulama erişimi verir; yasal velayet belgesi doğrulamaz.",
        "",
        "Daveti kabul etmek için bağlantıyı aç, kendi veli hesabınla giriş yap veya kayıt ol,",
        "e-postanı doğrula (gerekirse), sonra daveti açıkça kabul et.",
        "",
        "Davetli veli: planı, hedefleri ve kendisine yayınlanan paylaşımları görebilir.",
        "Plan/hedef görünürlüğü günlük paylaşımından ayrıdır; günlük paylaşımları çocuk alıcı seçerek onaylar.",
        "Davetli veli eşleştirme yönetemez ve başka veli davet edemez.",
        "",
        link,
        "",
        "Bağlantıyı yalnızca açmak erişim vermez.",
      ].join("\n"),
    });
  } catch (error) {
    reportMailFailure("guardian-invite", error);
    await prisma.guardianInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });
    throw new GuardianError("Davet e-postası gönderilemedi.", "MAIL");
  }

  return { invitation, token };
}

export async function revokeGuardianInvitation(input: {
  managerUserId: string;
  invitationId: string;
}) {
  const invite = await prisma.guardianInvitation.findUnique({
    where: { id: input.invitationId },
  });
  if (!invite) throw new GuardianError("Davet bulunamadı.", "NOT_FOUND");
  await requireManagerAccess(input.managerUserId, invite.childId);
  if (invite.redeemedAt || invite.revokedAt) {
    throw new GuardianError("Davet artık geçerli değil.", "REVOKED");
  }
  await prisma.guardianInvitation.update({
    where: { id: invite.id },
    data: { revokedAt: new Date() },
  });
}

export async function peekGuardianInvitation(token: string) {
  const invite = await prisma.guardianInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      child: { select: { id: true, displayName: true } },
      invitedBy: { select: { name: true } },
    },
  });
  if (!invite) return { status: "invalid" as const };
  if (invite.revokedAt) return { status: "revoked" as const, invite };
  if (invite.redeemedAt) return { status: "redeemed" as const, invite };
  if (invite.expiresAt < new Date()) return { status: "expired" as const, invite };
  return { status: "ok" as const, invite };
}

export async function acceptGuardianInvitation(input: {
  token: string;
  acceptorUserId: string;
}) {
  const acceptor = await prisma.user.findUniqueOrThrow({
    where: { id: input.acceptorUserId },
  });
  if (acceptor.role !== "PARENT") {
    throw new GuardianError("Davet yalnızca veli hesapları içindir.", "FORBIDDEN");
  }
  if (!acceptor.emailVerified) {
    throw new GuardianError(
      "Daveti kabul etmeden önce e-posta adresini doğrula.",
      "UNVERIFIED",
    );
  }

  const tokenHash = hashToken(input.token);

  return prisma.$transaction(async (tx) => {
    const invite = await tx.guardianInvitation.findUnique({
      where: { tokenHash },
    });
    if (!invite) throw new GuardianError("Davet bulunamadı.", "NOT_FOUND");
    if (invite.revokedAt) throw new GuardianError("Davet iptal edilmiş.", "REVOKED");
    if (invite.redeemedAt) throw new GuardianError("Davet zaten kullanılmış.", "REDEEMED");
    if (invite.expiresAt < new Date()) {
      throw new GuardianError("Davetin süresi dolmuş.", "EXPIRED");
    }
    if (normalizeGuardianEmail(acceptor.email) !== invite.email) {
      throw new GuardianError(
        "Bu davet başka bir e-posta adresine gönderilmiş. Doğru hesapla giriş yap.",
        "EMAIL_MISMATCH",
      );
    }

    // Re-check inviter still has managing authority.
    const inviterAccess = await tx.childGuardianAccess.findFirst({
      where: {
        childId: invite.childId,
        userId: invite.invitedByUserId,
        role: "MANAGER",
        revokedAt: null,
      },
    });
    if (!inviterAccess) {
      throw new GuardianError(
        "Daveti gönderen veli artık yönetici değil; davet geçersiz.",
        "INVITER_LOST_AUTH",
      );
    }

    const redeemed = await tx.guardianInvitation.updateMany({
      where: {
        id: invite.id,
        redeemedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { redeemedAt: new Date() },
    });
    if (redeemed.count !== 1) {
      throw new GuardianError("Davet eşzamanlı olarak kabul edilemedi.", "CONFLICT");
    }

    const active = await tx.childGuardianAccess.findFirst({
      where: {
        childId: invite.childId,
        userId: input.acceptorUserId,
        revokedAt: null,
      },
    });
    if (active) {
      throw new GuardianError("Bu çocuğa zaten erişimin var.", "DUPLICATE");
    }

    const prior = await tx.childGuardianAccess.findFirst({
      where: { childId: invite.childId, userId: input.acceptorUserId },
      orderBy: { generation: "desc" },
    });
    const generation = prior ? prior.generation + 1 : 1;

    await tx.childGuardianAccess.create({
      data: {
        childId: invite.childId,
        userId: input.acceptorUserId,
        role: "INVITED",
        generation,
      },
    });

    return { childId: invite.childId, generation };
  });
}

export async function removeGuardianAccess(input: {
  managerUserId: string;
  childId: string;
  targetUserId: string;
}) {
  await requireManagerAccess(input.managerUserId, input.childId);

  const target = await getActiveGuardianAccess(input.targetUserId, input.childId);
  if (!target) throw new GuardianError("Veli bulunamadı.", "NOT_FOUND");

  if (target.role === "MANAGER") {
    const managers = await prisma.childGuardianAccess.count({
      where: { childId: input.childId, role: "MANAGER", revokedAt: null },
    });
    if (managers <= 1) {
      throw new GuardianError(
        "Son yönetici veli kaldırılamaz.",
        "LAST_MANAGER",
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.childGuardianAccess.update({
      where: { id: target.id },
      data: { revokedAt: new Date() },
    });
    const email = (
      await tx.user.findUniqueOrThrow({ where: { id: input.targetUserId } })
    ).email;
    await tx.guardianInvitation.updateMany({
      where: {
        childId: input.childId,
        email: normalizeGuardianEmail(email),
        redeemedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  });
}

/** Active guardians eligible as share recipients (for child UI). */
export async function listShareableGuardians(childId: string) {
  const rows = await prisma.childGuardianAccess.findMany({
    where: { childId, revokedAt: null },
    include: {
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    userId: r.userId,
    name: r.user.name,
    role: r.role,
    generation: r.generation,
  }));
}

export async function replaceShareRecipients(input: {
  shareId: string;
  recipientUserIds: string[];
}) {
  const share = await prisma.publishedShare.findUniqueOrThrow({
    where: { id: input.shareId },
    select: { id: true, childId: true, withdrawnAt: true },
  });
  if (share.withdrawnAt) {
    throw new GuardianError("Geri çekilmiş paylaşımın alıcıları değişmez.", "FORBIDDEN");
  }

  const uniqueIds = [...new Set(input.recipientUserIds)];
  if (uniqueIds.length === 0) {
    throw new GuardianError("En az bir veli seçilmeli.", "FORBIDDEN");
  }

  const accesses = await prisma.childGuardianAccess.findMany({
    where: {
      childId: share.childId,
      userId: { in: uniqueIds },
      revokedAt: null,
    },
  });
  if (accesses.length !== uniqueIds.length) {
    throw new GuardianError("Seçilen velilerden biri artık erişime sahip değil.", "FORBIDDEN");
  }

  await prisma.$transaction(async (tx) => {
    await tx.publishedShareRecipient.deleteMany({ where: { shareId: share.id } });
    await tx.publishedShareRecipient.createMany({
      data: accesses.map((a) => ({
        shareId: share.id,
        guardianUserId: a.userId,
        accessGeneration: a.generation,
      })),
    });
  });
}
