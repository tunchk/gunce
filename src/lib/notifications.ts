import type { AppNotificationKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/lib/session";

export class NotificationError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION",
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

export type AppNotificationView = {
  id: string;
  kind: AppNotificationKind;
  title: string;
  body: string;
  href: string;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function toView(row: {
  id: string;
  kind: AppNotificationKind;
  title: string;
  body: string;
  href: string;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AppNotificationView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Generic list copy — never a narrative excerpt. */
export function journalSavedNotificationCopy(childDisplayName: string) {
  const name = childDisplayName.trim() || "Çocuğun";
  return {
    title: `${name} gününü anlattı.`,
    body: "Kaydedilen günlüğü açabilirsin.",
  };
}

export function legacyShareNotificationCopy(childDisplayName: string) {
  const name = childDisplayName.trim() || "Çocuğun";
  return {
    title: `${name} seninle bir şey paylaştı.`,
    body: "Onaylı paylaşımı açabilirsin.",
  };
}

export function reminderNotificationCopy(kind: "JOURNAL" | "STUDY_STEP") {
  if (kind === "STUDY_STEP") {
    return {
      title: "Çalışma adımı hatırlatması",
      body: "Planındaki bir adıma bakmak ister misin?",
    };
  }
  return {
    title: "Günlük yazma daveti",
    body: "İstersen bugünü kısaca anlatabilirsin.",
  };
}

/**
 * Create one JOURNAL_GUARDIAN_VISIBLE notification per active guardian.
 * Idempotent via uniquenessKey. Does not reset readAt on conflict.
 */
export async function notifyGuardiansOfVisibleEntry(input: {
  entryId: string;
  childId: string;
  childDisplayName: string;
  tx?: Prisma.TransactionClient;
}) {
  const db = input.tx ?? prisma;
  const guardians = await db.childGuardianAccess.findMany({
    where: { childId: input.childId, revokedAt: null },
    select: { userId: true },
  });
  if (guardians.length === 0) return { created: 0 };

  const copy = journalSavedNotificationCopy(input.childDisplayName);
  let created = 0;
  for (const g of guardians) {
    const uniquenessKey = `journal_visible:${input.entryId}:${g.userId}`;
    try {
      await db.appNotification.create({
        data: {
          recipientUserId: g.userId,
          kind: "JOURNAL_GUARDIAN_VISIBLE",
          uniquenessKey,
          title: copy.title,
          body: copy.body,
          href: `/veli/gunluk/${input.entryId}`,
          childId: input.childId,
          entryId: input.entryId,
        },
      });
      created += 1;
    } catch (error) {
      // Unique violation = already notified; leave read state alone.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }
  return { created };
}

/** Touch existing journal notifications after AI readiness (no new rows, no read reset). */
export async function touchJournalNotificationsForAi(entryId: string) {
  await prisma.appNotification.updateMany({
    where: {
      entryId,
      kind: "JOURNAL_GUARDIAN_VISIBLE",
      invalidatedAt: null,
    },
    data: {
      body: "Özet veya yaklaşım önerisi hazır olabilir.",
      updatedAt: new Date(),
    },
  });
}

export async function notifyLegacyShareRecipients(input: {
  shareId: string;
  entryId: string;
  childId: string;
  childDisplayName: string;
  recipientUserIds: string[];
}) {
  const copy = legacyShareNotificationCopy(input.childDisplayName);
  for (const userId of input.recipientUserIds) {
    const uniquenessKey = `legacy_share:${input.shareId}:${userId}`;
    const existing = await prisma.appNotification.findUnique({
      where: { uniquenessKey },
    });
    if (existing) {
      await prisma.appNotification.update({
        where: { id: existing.id },
        data: {
          updatedAt: new Date(),
          title: copy.title,
          body: copy.body,
          href: `/veli/paylasim/${input.shareId}`,
          invalidatedAt: null,
          // Do not reset readAt on republish touch.
        },
      });
      continue;
    }
    await prisma.appNotification.create({
      data: {
        recipientUserId: userId,
        kind: "LEGACY_SHARE_PUBLISHED",
        uniquenessKey,
        title: copy.title,
        body: copy.body,
        href: `/veli/paylasim/${input.shareId}`,
        childId: input.childId,
        entryId: input.entryId,
        shareId: input.shareId,
      },
    });
  }
}

export async function ensureReminderInAppNotification(input: {
  occurrenceId: string;
  childUserId: string;
  childId: string;
  kind: "JOURNAL" | "STUDY_STEP";
  href: string;
}) {
  const uniquenessKey = `reminder:${input.occurrenceId}`;
  const copy = reminderNotificationCopy(input.kind);
  try {
    await prisma.appNotification.create({
      data: {
        recipientUserId: input.childUserId,
        kind:
          input.kind === "STUDY_STEP" ? "REMINDER_STUDY_STEP" : "REMINDER_JOURNAL",
        uniquenessKey,
        title: copy.title,
        body: copy.body,
        href: input.href,
        childId: input.childId,
        reminderOccurrenceId: input.occurrenceId,
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return;
    }
    throw error;
  }
}

export async function invalidateNotificationsForGuardianChild(input: {
  guardianUserId: string;
  childId: string;
}) {
  await prisma.appNotification.updateMany({
    where: {
      recipientUserId: input.guardianUserId,
      childId: input.childId,
      invalidatedAt: null,
    },
    data: { invalidatedAt: new Date() },
  });
}

export async function invalidateNotificationsForEntry(entryId: string) {
  await prisma.appNotification.updateMany({
    where: { entryId, invalidatedAt: null },
    data: { invalidatedAt: new Date() },
  });
}

export async function invalidateNotificationsForShare(shareId: string) {
  await prisma.appNotification.updateMany({
    where: { shareId, invalidatedAt: null },
    data: { invalidatedAt: new Date() },
  });
}

export async function countUnreadNotifications(recipientUserId: string) {
  return prisma.appNotification.count({
    where: {
      recipientUserId,
      invalidatedAt: null,
      readAt: null,
    },
  });
}

export async function listNotifications(input: {
  recipientUserId: string;
  filter: "unread" | "all";
  cursor?: string | null;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const where: Prisma.AppNotificationWhereInput = {
    recipientUserId: input.recipientUserId,
    invalidatedAt: null,
    ...(input.filter === "unread" ? { readAt: null } : {}),
  };

  const rows = await prisma.appNotification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor
      ? {
          cursor: { id: input.cursor },
          skip: 1,
        }
      : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(toView),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

export async function markNotificationRead(input: {
  recipientUserId: string;
  notificationId: string;
}) {
  const row = await prisma.appNotification.findFirst({
    where: {
      id: input.notificationId,
      recipientUserId: input.recipientUserId,
      invalidatedAt: null,
    },
  });
  if (!row) {
    throw new NotificationError("Bildirim bulunamadı.", "NOT_FOUND");
  }
  if (!row.readAt) {
    await prisma.appNotification.update({
      where: { id: row.id },
      data: { readAt: new Date() },
    });
  }
  const fresh = await prisma.appNotification.findUniqueOrThrow({
    where: { id: row.id },
  });
  return toView(fresh);
}

/** Mark journal-visible notifications for an entry as read for one recipient. */
export async function markJournalEntryNotificationsRead(input: {
  recipientUserId: string;
  entryId: string;
}) {
  await prisma.appNotification.updateMany({
    where: {
      recipientUserId: input.recipientUserId,
      entryId: input.entryId,
      kind: "JOURNAL_GUARDIAN_VISIBLE",
      invalidatedAt: null,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(recipientUserId: string) {
  const result = await prisma.appNotification.updateMany({
    where: {
      recipientUserId,
      invalidatedAt: null,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}

export async function requireNotificationOwner(
  recipientUserId: string,
  notificationId: string,
) {
  const row = await prisma.appNotification.findFirst({
    where: { id: notificationId, recipientUserId },
  });
  if (!row || row.invalidatedAt) {
    throw new NotificationError("Bildirim bulunamadı.", "NOT_FOUND");
  }
  return row;
}

export async function assertSameRecipientOrThrow(
  sessionUserId: string,
  targetUserId: string,
) {
  if (sessionUserId !== targetUserId) {
    throw new AuthorizationError("Bu bildirime erişemezsin.");
  }
}
