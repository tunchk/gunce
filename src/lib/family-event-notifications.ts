import { familyEventTypeLabel } from "@/lib/family-calendar-labels";
import { prisma } from "@/lib/prisma";
import { formatDayLabelTr } from "@/lib/plan-dates";
import type { FamilyEventType, Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

async function activeGuardianUserIds(childId: string, db: Db) {
  const guardians = await db.childGuardianAccess.findMany({
    where: { childId, revokedAt: null },
    select: { userId: true },
  });
  return guardians.map((g) => g.userId);
}

async function childUserId(childId: string, db: Db) {
  const child = await db.childProfile.findUnique({
    where: { id: childId },
    select: { userId: true },
  });
  return child?.userId ?? null;
}

async function createOne(input: {
  recipientUserId: string;
  kind: "FAMILY_EVENT_CREATED" | "FAMILY_EVENT_UPDATED" | "FAMILY_EVENT_CANCELLED";
  uniquenessKey: string;
  title: string;
  body: string;
  href: string;
  childId: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  try {
    await db.appNotification.create({
      data: {
        recipientUserId: input.recipientUserId,
        kind: input.kind,
        uniquenessKey: input.uniquenessKey,
        title: input.title,
        body: input.body,
        href: input.href,
        childId: input.childId,
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

function whenLabel(eventDate: string, startTimeLocal: string | null) {
  const day = formatDayLabelTr(eventDate);
  return startTimeLocal ? `${day} ${startTimeLocal}` : day;
}

async function recipientsExceptActor(input: {
  childId: string;
  actorUserId: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  const ids = new Set(await activeGuardianUserIds(input.childId, db));
  const childUid = await childUserId(input.childId, db);
  if (childUid) ids.add(childUid);
  ids.delete(input.actorUserId);
  return [...ids];
}

export async function notifyFamilyEventCreated(input: {
  eventId: string;
  childId: string;
  actorUserId: string;
  title: string;
  eventDate: string;
  startTimeLocal: string | null;
  eventType: FamilyEventType;
}) {
  const typeLabel = familyEventTypeLabel(input.eventType);
  const when = whenLabel(input.eventDate, input.startTimeLocal);
  const recipients = await recipientsExceptActor(input);
  for (const userId of recipients) {
    const isChild =
      (await childUserId(input.childId, prisma)) === userId;
    await createOne({
      recipientUserId: userId,
      kind: "FAMILY_EVENT_CREATED",
      uniquenessKey: `family_event_created:${input.eventId}:${userId}`,
      title: "Aile takvimine etkinlik eklendi",
      body: `${input.title} · ${typeLabel} · ${when}`,
      href: isChild ? `/cocuk/haftam` : `/veli/takvim`,
      childId: input.childId,
    });
  }
}

export async function notifyFamilyEventUpdated(input: {
  eventId: string;
  childId: string;
  actorUserId: string;
  title: string;
  eventDate: string;
  startTimeLocal: string | null;
  eventType: FamilyEventType;
}) {
  const typeLabel = familyEventTypeLabel(input.eventType);
  const when = whenLabel(input.eventDate, input.startTimeLocal);
  const recipients = await recipientsExceptActor(input);
  for (const userId of recipients) {
    const isChild =
      (await childUserId(input.childId, prisma)) === userId;
    await createOne({
      recipientUserId: userId,
      kind: "FAMILY_EVENT_UPDATED",
      uniquenessKey: `family_event_updated:${input.eventId}:${input.eventDate}:${input.startTimeLocal ?? "none"}:${userId}`,
      title: "Aile etkinliği güncellendi",
      body: `${input.title} · ${typeLabel} · ${when}`,
      href: isChild ? `/cocuk/haftam` : `/veli/takvim`,
      childId: input.childId,
    });
  }
}

export async function notifyFamilyEventCancelled(input: {
  eventId: string;
  childId: string;
  actorUserId: string;
  title: string;
  eventDate: string;
  eventType: FamilyEventType;
}) {
  const typeLabel = familyEventTypeLabel(input.eventType);
  const when = formatDayLabelTr(input.eventDate);
  const recipients = await recipientsExceptActor(input);
  for (const userId of recipients) {
    const isChild =
      (await childUserId(input.childId, prisma)) === userId;
    await createOne({
      recipientUserId: userId,
      kind: "FAMILY_EVENT_CANCELLED",
      uniquenessKey: `family_event_cancelled:${input.eventId}:${userId}`,
      title: "Aile etkinliği iptal edildi",
      body: `${input.title} · ${typeLabel} · ${when}`,
      href: isChild ? `/cocuk/haftam` : `/veli/takvim`,
      childId: input.childId,
    });
  }
}
