import type { FamilyEventType, Prisma } from "@prisma/client";
import {
  familyEventTypeLabel,
} from "@/lib/family-calendar-labels";
import {
  FAMILY_EVENT_TYPES,
  type FamilyEventView,
} from "@/lib/family-calendar-types";
import { prisma } from "@/lib/prisma";
import {
  formatCalendarDate,
  isValidEventTimeLocal,
  parseCalendarDate,
} from "@/lib/plan-dates";
import { AuthorizationError } from "@/lib/session";

export class FamilyEventError extends Error {
  constructor(
    message: string,
    public code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "VALIDATION"
      | "GONE" = "VALIDATION",
  ) {
    super(message);
    this.name = "FamilyEventError";
  }
}

export const FAMILY_EVENT_TITLE_MAX = 80;
export const FAMILY_EVENT_NOTE_MAX = 160;

type Db = Prisma.TransactionClient | typeof prisma;

async function requireChildProfile(childUserId: string) {
  const child = await prisma.childProfile.findUnique({
    where: { userId: childUserId },
  });
  if (!child) throw new AuthorizationError("Çocuk profili bulunamadı.");
  return child;
}

async function requireGuardianAccess(parentUserId: string, childId: string) {
  const access = await prisma.childGuardianAccess.findFirst({
    where: { userId: parentUserId, childId, revokedAt: null },
  });
  if (!access) {
    throw new FamilyEventError("Kayıt bulunamadı.", "NOT_FOUND");
  }
  return access;
}

function clampText(raw: string | undefined, max: number): string {
  return (raw ?? "").trim().slice(0, max);
}

function normalizeTimes(start?: string | null, end?: string | null) {
  const startTimeLocal =
    typeof start === "string" && start.trim() ? start.trim() : null;
  const endTimeLocal =
    typeof end === "string" && end.trim() ? end.trim() : null;
  if (startTimeLocal && !isValidEventTimeLocal(startTimeLocal)) {
    throw new FamilyEventError("Başlangıç saati HH:mm olmalı.", "VALIDATION");
  }
  if (endTimeLocal && !isValidEventTimeLocal(endTimeLocal)) {
    throw new FamilyEventError("Bitiş saati HH:mm olmalı.", "VALIDATION");
  }
  if (endTimeLocal && !startTimeLocal) {
    throw new FamilyEventError("Bitiş için başlangıç saati gerekli.", "VALIDATION");
  }
  if (startTimeLocal && endTimeLocal && endTimeLocal <= startTimeLocal) {
    throw new FamilyEventError("Bitiş saati başlangıçtan sonra olmalı.", "VALIDATION");
  }
  return { startTimeLocal, endTimeLocal };
}

function toView(
  row: {
    id: string;
    childId: string;
    createdByUserId: string;
    title: string;
    eventDate: Date;
    startTimeLocal: string | null;
    endTimeLocal: string | null;
    eventType: FamilyEventType;
    note: string;
    cancelledAt: Date | null;
    createdAt: Date;
    createdBy: { id: string; name: string };
  },
  viewerUserId: string,
): FamilyEventView {
  const isCreator = row.createdByUserId === viewerUserId;
  const active = !row.cancelledAt;
  return {
    id: row.id,
    childId: row.childId,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdBy.name.trim() || "Aile",
    title: row.title,
    eventDate: formatCalendarDate(row.eventDate)!,
    startTimeLocal: row.startTimeLocal,
    endTimeLocal: row.endTimeLocal,
    eventType: row.eventType,
    eventTypeLabel: familyEventTypeLabel(row.eventType),
    note: row.note,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    canEdit: isCreator && active,
    canCancel: isCreator && active,
  };
}

const eventInclude = {
  createdBy: { select: { id: true, name: true } },
} as const;

export async function createFamilyEvent(input: {
  actorUserId: string;
  actorRole: "CHILD" | "PARENT";
  childId?: string;
  title: string;
  eventDate: string;
  startTimeLocal?: string | null;
  endTimeLocal?: string | null;
  eventType: FamilyEventType;
  note?: string;
}) {
  if (!FAMILY_EVENT_TYPES.includes(input.eventType)) {
    throw new FamilyEventError("Etkinlik türü geçersiz.", "VALIDATION");
  }
  const title = clampText(input.title, FAMILY_EVENT_TITLE_MAX);
  if (!title) throw new FamilyEventError("Başlık gerekli.", "VALIDATION");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) {
    throw new FamilyEventError("Geçerli bir tarih seç.", "VALIDATION");
  }
  const note = clampText(input.note, FAMILY_EVENT_NOTE_MAX);
  const times = normalizeTimes(input.startTimeLocal, input.endTimeLocal);

  let childId: string;
  if (input.actorRole === "CHILD") {
    const child = await requireChildProfile(input.actorUserId);
    childId = child.id;
  } else {
    if (!input.childId?.trim()) {
      throw new FamilyEventError("Çocuk seçimi gerekli.", "VALIDATION");
    }
    childId = input.childId.trim();
    await requireGuardianAccess(input.actorUserId, childId);
  }

  const row = await prisma.familyEvent.create({
    data: {
      childId,
      createdByUserId: input.actorUserId,
      title,
      eventDate: parseCalendarDate(input.eventDate),
      startTimeLocal: times.startTimeLocal,
      endTimeLocal: times.endTimeLocal,
      eventType: input.eventType,
      note,
    },
    include: eventInclude,
  });

  const { notifyFamilyEventCreated } = await import(
    "@/lib/family-event-notifications"
  );
  await notifyFamilyEventCreated({
    eventId: row.id,
    childId,
    actorUserId: input.actorUserId,
    title: row.title,
    eventDate: input.eventDate,
    startTimeLocal: times.startTimeLocal,
    eventType: row.eventType,
  });

  return toView(row, input.actorUserId);
}

export async function updateFamilyEvent(input: {
  actorUserId: string;
  eventId: string;
  title?: string;
  eventDate?: string;
  startTimeLocal?: string | null;
  endTimeLocal?: string | null;
  eventType?: FamilyEventType;
  note?: string;
}) {
  const row = await prisma.familyEvent.findUnique({
    where: { id: input.eventId },
    include: eventInclude,
  });
  if (!row || row.cancelledAt) {
    throw new FamilyEventError("Kayıt bulunamadı.", "NOT_FOUND");
  }
  if (row.createdByUserId !== input.actorUserId) {
    throw new FamilyEventError("Kayıt bulunamadı.", "NOT_FOUND");
  }

  // Creator must still have access: child owns profile, guardian must be active.
  const creatorIsChild = await prisma.childProfile.findFirst({
    where: { id: row.childId, userId: input.actorUserId },
  });
  if (!creatorIsChild) {
    await requireGuardianAccess(input.actorUserId, row.childId);
  }

  const title =
    input.title !== undefined
      ? clampText(input.title, FAMILY_EVENT_TITLE_MAX)
      : row.title;
  if (!title) throw new FamilyEventError("Başlık gerekli.", "VALIDATION");

  let eventDate = row.eventDate;
  let eventDateIso = formatCalendarDate(row.eventDate)!;
  if (input.eventDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) {
      throw new FamilyEventError("Geçerli bir tarih seç.", "VALIDATION");
    }
    eventDate = parseCalendarDate(input.eventDate);
    eventDateIso = input.eventDate;
  }

  const eventType =
    input.eventType !== undefined ? input.eventType : row.eventType;
  if (!FAMILY_EVENT_TYPES.includes(eventType)) {
    throw new FamilyEventError("Etkinlik türü geçersiz.", "VALIDATION");
  }

  const note =
    input.note !== undefined
      ? clampText(input.note, FAMILY_EVENT_NOTE_MAX)
      : row.note;

  const times = normalizeTimes(
    input.startTimeLocal !== undefined ? input.startTimeLocal : row.startTimeLocal,
    input.endTimeLocal !== undefined ? input.endTimeLocal : row.endTimeLocal,
  );

  const updated = await prisma.familyEvent.update({
    where: { id: row.id },
    data: {
      title,
      eventDate,
      startTimeLocal: times.startTimeLocal,
      endTimeLocal: times.endTimeLocal,
      eventType,
      note,
    },
    include: eventInclude,
  });

  const { notifyFamilyEventUpdated } = await import(
    "@/lib/family-event-notifications"
  );
  await notifyFamilyEventUpdated({
    eventId: updated.id,
    childId: updated.childId,
    actorUserId: input.actorUserId,
    title: updated.title,
    eventDate: eventDateIso,
    startTimeLocal: times.startTimeLocal,
    eventType: updated.eventType,
  });

  return toView(updated, input.actorUserId);
}

export async function cancelFamilyEvent(input: {
  actorUserId: string;
  eventId: string;
}) {
  const row = await prisma.familyEvent.findUnique({
    where: { id: input.eventId },
    include: eventInclude,
  });
  if (!row || row.cancelledAt) {
    throw new FamilyEventError("Kayıt bulunamadı.", "NOT_FOUND");
  }
  if (row.createdByUserId !== input.actorUserId) {
    throw new FamilyEventError("Kayıt bulunamadı.", "NOT_FOUND");
  }

  const creatorIsChild = await prisma.childProfile.findFirst({
    where: { id: row.childId, userId: input.actorUserId },
  });
  if (!creatorIsChild) {
    await requireGuardianAccess(input.actorUserId, row.childId);
  }

  const updated = await prisma.familyEvent.update({
    where: { id: row.id },
    data: { cancelledAt: new Date() },
    include: eventInclude,
  });

  const { notifyFamilyEventCancelled } = await import(
    "@/lib/family-event-notifications"
  );
  await notifyFamilyEventCancelled({
    eventId: updated.id,
    childId: updated.childId,
    actorUserId: input.actorUserId,
    title: updated.title,
    eventDate: formatCalendarDate(updated.eventDate)!,
    eventType: updated.eventType,
  });

  return toView(updated, input.actorUserId);
}

export async function getFamilyEvent(input: {
  viewerUserId: string;
  viewerRole: "CHILD" | "PARENT";
  eventId: string;
}) {
  const row = await prisma.familyEvent.findUnique({
    where: { id: input.eventId },
    include: eventInclude,
  });
  if (!row) throw new FamilyEventError("Kayıt bulunamadı.", "NOT_FOUND");

  if (input.viewerRole === "CHILD") {
    const child = await requireChildProfile(input.viewerUserId);
    if (row.childId !== child.id) {
      throw new FamilyEventError("Kayıt bulunamadı.", "NOT_FOUND");
    }
  } else {
    await requireGuardianAccess(input.viewerUserId, row.childId);
  }

  return toView(row, input.viewerUserId);
}

export async function listFamilyEventsForChildRange(input: {
  childId: string;
  fromDate: string;
  toDate: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  const rows = await db.familyEvent.findMany({
    where: {
      childId: input.childId,
      cancelledAt: null,
      eventDate: {
        gte: parseCalendarDate(input.fromDate),
        lte: parseCalendarDate(input.toDate),
      },
    },
    include: eventInclude,
    orderBy: [{ eventDate: "asc" }, { startTimeLocal: "asc" }, { createdAt: "asc" }],
  });
  return rows;
}
