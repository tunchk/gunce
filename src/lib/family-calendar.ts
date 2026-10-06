import { listAcceptedHelpSessionsForChildId } from "@/lib/help";
import { listFamilyEventsForChildRange } from "@/lib/family-events";
import { prisma } from "@/lib/prisma";
import {
  addCalendarDays,
  calendarDateInTimeZone,
  formatCalendarDate,
  startOfWeekMonday,
  weekDatesFromMonday,
} from "@/lib/plan-dates";
import { commitmentTypeLabel } from "@/lib/plan-ui";
import { AuthorizationError } from "@/lib/session";
import { FamilyEventError } from "@/lib/family-events";
import { detectPossibleConflictIds } from "@/lib/family-calendar-conflicts";
import {
  familyCalendarKindLabel,
  familyEventTypeLabel,
} from "@/lib/family-calendar-labels";
import type {
  FamilyCalendarItem,
  FamilyCoordinationWeek,
} from "@/lib/family-calendar-types";

async function loadAuthorizedChild(input: {
  viewerUserId: string;
  viewerRole: "CHILD" | "PARENT";
  childId?: string;
}) {
  if (input.viewerRole === "CHILD") {
    const child = await prisma.childProfile.findUnique({
      where: { userId: input.viewerUserId },
    });
    if (!child) throw new AuthorizationError("Çocuk profili bulunamadı.");
    return child;
  }

  if (!input.childId?.trim()) {
    throw new FamilyEventError("Çocuk seçimi gerekli.", "VALIDATION");
  }
  const access = await prisma.childGuardianAccess.findFirst({
    where: {
      userId: input.viewerUserId,
      childId: input.childId.trim(),
      revokedAt: null,
    },
  });
  if (!access) {
    throw new FamilyEventError("Kayıt bulunamadı.", "NOT_FOUND");
  }
  const child = await prisma.childProfile.findUniqueOrThrow({
    where: { id: input.childId.trim() },
  });
  return child;
}

function sortKey(item: FamilyCalendarItem): string {
  const time = item.startTimeLocal || "99:99";
  return `${item.date}T${time}:${item.kind}:${item.id}`;
}

function applyConflicts(items: FamilyCalendarItem[]): FamilyCalendarItem[] {
  const flagged = detectPossibleConflictIds(
    items.map((i) => ({
      id: i.id,
      date: i.date,
      startTimeLocal: i.startTimeLocal,
      endTimeLocal: i.endTimeLocal,
    })),
  );
  return items.map((item) => {
    if (!flagged.has(item.id)) return item;
    return {
      ...item,
      possibleConflict: true,
      conflictHint: "Bu saatte başka bir plan daha var.",
    };
  });
}

/**
 * Aggregates plan items, accepted help sessions, and FamilyEvents for one child week.
 * Does not persist derived calendar rows. Never includes journal/AI/reflection content.
 */
export async function getFamilyCoordinationWeek(input: {
  viewerUserId: string;
  viewerRole: "CHILD" | "PARENT";
  childId?: string;
  weekStartIso?: string;
}): Promise<FamilyCoordinationWeek> {
  const child = await loadAuthorizedChild(input);
  const today = calendarDateInTimeZone(child.timeZone);
  const monday = startOfWeekMonday(input.weekStartIso || today);
  const sunday = addCalendarDays(monday, 6);
  const dates = weekDatesFromMonday(monday);
  const from = parseBound(monday);
  const to = parseBound(sunday);

  const [commitments, steps, familyRows, helpSessions] = await Promise.all([
    prisma.planCommitment.findMany({
      where: {
        childId: child.id,
        OR: [
          { dueDate: { gte: from, lte: to } },
          { eventDate: { gte: from, lte: to } },
        ],
      },
      orderBy: [{ eventDate: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.planStudyStep.findMany({
      where: {
        childId: child.id,
        plannedDate: { gte: from, lte: to },
      },
      orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
      // Privacy: never select completionReflection for calendar aggregation.
      select: {
        id: true,
        title: true,
        plannedDate: true,
        status: true,
      },
    }),
    listFamilyEventsForChildRange({
      childId: child.id,
      fromDate: monday,
      toDate: sunday,
    }),
    listAcceptedHelpSessionsForChildId(child.id, {
      fromDate: monday,
      toDate: sunday,
    }),
  ]);

  const isChildViewer = input.viewerRole === "CHILD";
  const items: FamilyCalendarItem[] = [];

  for (const c of commitments) {
    const date =
      c.type === "HOMEWORK"
        ? formatCalendarDate(c.dueDate)
        : formatCalendarDate(c.eventDate);
    if (!date || date < monday || date > sunday) continue;
    items.push({
      id: `commitment:${c.id}`,
      kind: "COMMITMENT",
      kindLabel: familyCalendarKindLabel("COMMITMENT"),
      date,
      startTimeLocal: c.eventTimeLocal,
      endTimeLocal: null,
      title: `${commitmentTypeLabel(c.type)}: ${c.title}`,
      status: c.completedAt ? "DONE" : "OPEN",
      statusLabel: c.completedAt ? "Tamamlandı" : "Açık",
      href: isChildViewer ? `/cocuk/plan/is/${c.id}` : `/veli/plan/is/${c.id}`,
      sourceId: c.id,
      note: null,
      createdByUserId: null,
      createdByName: null,
      canEdit: false,
      canCancel: false,
      helpTypeLabel: null,
      guardianName: null,
      possibleConflict: false,
      conflictHint: null,
    });
  }

  for (const s of steps) {
    const date = formatCalendarDate(s.plannedDate);
    if (!date) continue;
    items.push({
      id: `study_step:${s.id}`,
      kind: "STUDY_STEP",
      kindLabel: familyCalendarKindLabel("STUDY_STEP"),
      date,
      // Reminder time is not a measured study start — date-only for coordination.
      startTimeLocal: null,
      endTimeLocal: null,
      title: s.title,
      status: s.status,
      statusLabel: s.status === "DONE" ? "Bitti" : "Çalışma",
      href: isChildViewer
        ? `/cocuk/plan/adim/${s.id}`
        : `/veli/plan/adim/${s.id}`,
      sourceId: s.id,
      note: null,
      createdByUserId: null,
      createdByName: null,
      canEdit: false,
      canCancel: false,
      helpTypeLabel: null,
      guardianName: null,
      possibleConflict: false,
      conflictHint: null,
    });
  }

  for (const session of helpSessions) {
    if (session.status !== "ACCEPTED") continue;
    items.push({
      id: `help:${session.requestId}`,
      kind: "HELP_SESSION",
      kindLabel: familyCalendarKindLabel("HELP_SESSION"),
      date: session.proposedDate,
      startTimeLocal: session.proposedTimeLocal,
      endTimeLocal: null,
      title: session.planItem.title,
      status: "ACCEPTED",
      statusLabel: "Planlandı",
      href: isChildViewer
        ? `/cocuk/yardim/${session.requestId}`
        : `/veli/yardim/${session.requestId}`,
      sourceId: session.requestId,
      note: null,
      createdByUserId: null,
      createdByName: null,
      canEdit: false,
      canCancel: false,
      helpTypeLabel: session.helpTypeLabel,
      guardianName: session.guardianName,
      possibleConflict: false,
      conflictHint: null,
    });
  }

  for (const ev of familyRows) {
    const isCreator = ev.createdByUserId === input.viewerUserId;
    items.push({
      id: `family_event:${ev.id}`,
      kind: "FAMILY_EVENT",
      kindLabel: familyCalendarKindLabel("FAMILY_EVENT"),
      date: formatCalendarDate(ev.eventDate)!,
      startTimeLocal: ev.startTimeLocal,
      endTimeLocal: ev.endTimeLocal,
      title: ev.title,
      status: "ACTIVE",
      statusLabel: familyEventTypeLabel(ev.eventType),
      href: isChildViewer
        ? `/cocuk/takvim/etkinlik/${ev.id}`
        : `/veli/takvim/etkinlik/${ev.id}`,
      sourceId: ev.id,
      note: ev.note || null,
      createdByUserId: ev.createdByUserId,
      createdByName: ev.createdBy.name.trim() || "Aile",
      canEdit: isCreator,
      canCancel: isCreator,
      helpTypeLabel: null,
      guardianName: null,
      possibleConflict: false,
      conflictHint: null,
    });
  }

  const withConflicts = applyConflicts(items).sort((a, b) =>
    sortKey(a).localeCompare(sortKey(b)),
  );

  const days = dates.map((date) => ({
    date,
    items: withConflicts.filter((i) => i.date === date),
  }));

  return {
    childId: child.id,
    childDisplayName: child.displayName,
    timeZone: child.timeZone,
    today,
    weekStart: monday,
    weekEnd: sunday,
    days,
    familyEventCount: familyRows.length,
  };
}

function parseBound(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Today's coordination items for Bugün (family events + help + plan already separate). */
export async function getTodayFamilyCoordinationExtras(input: {
  childUserId: string;
}) {
  const week = await getFamilyCoordinationWeek({
    viewerUserId: input.childUserId,
    viewerRole: "CHILD",
  });
  const today = week.days.find((d) => d.date === week.today);
  const items = today?.items ?? [];
  return {
    today: week.today,
    familyEvents: items.filter((i) => i.kind === "FAMILY_EVENT"),
    helpSessions: items.filter((i) => i.kind === "HELP_SESSION"),
    possibleConflicts: items.filter((i) => i.possibleConflict),
  };
}
