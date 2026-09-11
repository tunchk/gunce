import type { PlanCommitmentType, PlanStudyStepStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/lib/session";
import {
  addCalendarDays,
  calendarDateInTimeZone,
  compareCalendarDates,
  formatCalendarDate,
  isValidEventTimeLocal,
  parseCalendarDate,
  startOfWeekMonday,
  weekDatesFromMonday,
} from "@/lib/plan-dates";

export const PLAN_TITLE_MAX = 200;
export const PLAN_SUBJECT_MAX = 80;
export const PLAN_MINUTES_MAX = 24 * 60;

export const STUDY_STEP_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;
export type StudyStepStatus = (typeof STUDY_STEP_STATUSES)[number];

const OPEN_STATUSES: PlanStudyStepStatus[] = ["TODO", "IN_PROGRESS"];

export class PlanError extends Error {
  constructor(
    message: string,
    public code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "VALIDATION"
      | "UNAUTHORIZED"
      | "GONE"
      | "DEADLINE_WARNING",
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PlanError";
  }
}

async function requireChildProfile(childUserId: string) {
  const child = await prisma.childProfile.findUnique({
    where: { userId: childUserId },
  });
  if (!child) throw new AuthorizationError("Çocuk profili bulunamadı.");
  return child;
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function parseOptionalMinutes(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > PLAN_MINUTES_MAX) {
    throw new PlanError("Süre 1–1440 dakika arasında olmalı.", "VALIDATION");
  }
  return n;
}

function parseOptionalReminderTime(
  value: unknown,
  plannedDate: Date | null,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !isValidEventTimeLocal(value.trim())) {
    throw new PlanError("Hatırlatma saati HH:mm olmalı.", "VALIDATION");
  }
  if (!plannedDate) {
    throw new PlanError(
      "Hatırlatma için önce planlanan gün seçmelisin.",
      "VALIDATION",
    );
  }
  return value.trim();
}

function parseOptionalCalendar(value: unknown, label: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new PlanError(`${label} geçersiz.`, "VALIDATION");
  }
  try {
    return parseCalendarDate(value);
  } catch {
    throw new PlanError(`${label} geçersiz.`, "VALIDATION");
  }
}

export type CommitmentView = {
  id: string;
  type: PlanCommitmentType;
  title: string;
  subject: string;
  dueDate: string | null;
  eventDate: string | null;
  eventTimeLocal: string | null;
  completedAt: string | null;
  revision: number;
  studyStepCount: number;
};

export type StudyStepView = {
  id: string;
  title: string;
  subject: string;
  plannedDate: string | null;
  estimatedMinutes: number | null;
  /** Reminder wall time HH:mm; null = no step reminder. Not a measured study start. */
  reminderLocalTime: string | null;
  relatedCommitmentId: string | null;
  relatedCommitmentTitle: string | null;
  relatedDeadline: string | null;
  relatedGoalId: string | null;
  relatedGoalTitle: string | null;
  status: StudyStepStatus;
  /** Metadata only; null when not DONE or when historical timestamp was lost. */
  completedAt: string | null;
  revision: number;
  afterDeadline: boolean;
};

function commitmentDeadlineIso(c: {
  type: PlanCommitmentType;
  dueDate: Date | null;
  eventDate: Date | null;
}): string | null {
  if (c.type === "HOMEWORK") return formatCalendarDate(c.dueDate);
  return formatCalendarDate(c.eventDate);
}

function toCommitmentView(
  c: {
    id: string;
    type: PlanCommitmentType;
    title: string;
    subject: string;
    dueDate: Date | null;
    eventDate: Date | null;
    eventTimeLocal: string | null;
    completedAt: Date | null;
    revision: number;
    _count?: { studySteps: number };
  },
): CommitmentView {
  return {
    id: c.id,
    type: c.type,
    title: c.title,
    subject: c.subject,
    dueDate: formatCalendarDate(c.dueDate),
    eventDate: formatCalendarDate(c.eventDate),
    eventTimeLocal: c.eventTimeLocal,
    completedAt: c.completedAt?.toISOString() ?? null,
    revision: c.revision,
    studyStepCount: c._count?.studySteps ?? 0,
  };
}

export function toStudyStepViewFromRow(
  s: {
    id: string;
    title: string;
    subject: string;
    plannedDate: Date | null;
    estimatedMinutes: number | null;
    reminderLocalTime?: string | null;
    relatedCommitmentId: string | null;
    relatedGoalId?: string | null;
    status: PlanStudyStepStatus;
    completedAt: Date | null;
    revision: number;
    relatedCommitment?: {
      title: string;
      type: PlanCommitmentType;
      dueDate: Date | null;
      eventDate: Date | null;
    } | null;
    relatedGoal?: {
      id: string;
      title: string;
    } | null;
  },
): StudyStepView {
  const relatedDeadline = s.relatedCommitment
    ? commitmentDeadlineIso(s.relatedCommitment)
    : null;
  const planned = formatCalendarDate(s.plannedDate);
  const afterDeadline = Boolean(
    planned && relatedDeadline && compareCalendarDates(planned, relatedDeadline) > 0,
  );
  return {
    id: s.id,
    title: s.title,
    subject: s.subject,
    plannedDate: planned,
    estimatedMinutes: s.estimatedMinutes,
    reminderLocalTime: s.reminderLocalTime ?? null,
    relatedCommitmentId: s.relatedCommitmentId,
    relatedCommitmentTitle: s.relatedCommitment?.title ?? null,
    relatedDeadline,
    relatedGoalId: s.relatedGoalId ?? s.relatedGoal?.id ?? null,
    relatedGoalTitle: s.relatedGoal?.title ?? null,
    status: s.status,
    completedAt: s.completedAt?.toISOString() ?? null,
    revision: s.revision,
    afterDeadline,
  };
}

function toStudyStepView(
  s: Parameters<typeof toStudyStepViewFromRow>[0],
): StudyStepView {
  return toStudyStepViewFromRow(s);
}

const stepInclude = {
  relatedCommitment: {
    select: { title: true, type: true, dueDate: true, eventDate: true },
  },
  relatedGoal: {
    select: { id: true, title: true },
  },
} satisfies Prisma.PlanStudyStepInclude;

export async function createCommitment(input: {
  childUserId: string;
  type: PlanCommitmentType;
  title: string;
  subject?: string;
  dueDate?: string | null;
  eventDate?: string | null;
  eventTimeLocal?: string | null;
  dateUnknown?: boolean;
  clientRequestId?: string | null;
}) {
  const child = await requireChildProfile(input.childUserId);
  const clientRequestId = input.clientRequestId?.trim() || null;
  if (clientRequestId) {
    const existing = await prisma.planCommitment.findUnique({
      where: { clientRequestId },
      include: { _count: { select: { studySteps: true } } },
    });
    if (existing) {
      if (existing.childId !== child.id) {
        throw new PlanError("Bu istek başka bir kayda ait.", "CONFLICT");
      }
      return toCommitmentView(existing);
    }
  }

  const title = clampText(input.title, PLAN_TITLE_MAX);
  if (!title) throw new PlanError("Başlık gerekli.", "VALIDATION");
  const subject = clampText(input.subject ?? "", PLAN_SUBJECT_MAX);

  let dueDate: Date | null = null;
  let eventDate: Date | null = null;
  let eventTimeLocal: string | null = null;

  if (input.type === "HOMEWORK") {
    if (input.dateUnknown) {
      dueDate = null;
    } else {
      dueDate = parseOptionalCalendar(input.dueDate, "Teslim tarihi");
    }
  } else if (input.type === "EXAM" || input.type === "COURSE") {
    eventDate = parseOptionalCalendar(input.eventDate, "Tarih");
    if (!eventDate) throw new PlanError("Sınav veya etkinlik için tarih gerekli.", "VALIDATION");
    const time = typeof input.eventTimeLocal === "string" ? input.eventTimeLocal.trim() : "";
    if (time) {
      if (!isValidEventTimeLocal(time)) {
        throw new PlanError("Saat HH:mm biçiminde olmalı.", "VALIDATION");
      }
      eventTimeLocal = time;
    }
  } else {
    throw new PlanError("Geçersiz tür.", "VALIDATION");
  }

  const created = await prisma.planCommitment.create({
    data: {
      childId: child.id,
      type: input.type,
      title,
      subject,
      dueDate,
      eventDate,
      eventTimeLocal,
      clientRequestId,
    },
    include: { _count: { select: { studySteps: true } } },
  });
  return toCommitmentView(created);
}

export async function createStudyStep(input: {
  childUserId: string;
  title: string;
  subject?: string;
  plannedDate?: string | null;
  estimatedMinutes?: number | null;
  reminderLocalTime?: string | null;
  relatedCommitmentId?: string | null;
  relatedGoalId?: string | null;
  allowAfterDeadline?: boolean;
  clientRequestId?: string | null;
}) {
  const child = await requireChildProfile(input.childUserId);
  const clientRequestId = input.clientRequestId?.trim() || null;
  if (clientRequestId) {
    const existing = await prisma.planStudyStep.findUnique({
      where: { clientRequestId },
      include: stepInclude,
    });
    if (existing) {
      if (existing.childId !== child.id) {
        throw new PlanError("Bu istek başka bir kayda ait.", "CONFLICT");
      }
      return toStudyStepView(existing);
    }
  }

  const title = clampText(input.title, PLAN_TITLE_MAX);
  if (!title) throw new PlanError("Başlık gerekli.", "VALIDATION");
  const subject = clampText(input.subject ?? "", PLAN_SUBJECT_MAX);
  const plannedDate = parseOptionalCalendar(input.plannedDate, "Planlanan gün");
  const estimatedMinutes = parseOptionalMinutes(input.estimatedMinutes ?? null);
  const reminderLocalTime = parseOptionalReminderTime(
    input.reminderLocalTime,
    plannedDate,
  );

  let relatedCommitmentId: string | null = null;
  let related:
    | {
        title: string;
        type: PlanCommitmentType;
        dueDate: Date | null;
        eventDate: Date | null;
      }
    | null = null;

  if (input.relatedCommitmentId) {
    const relatedRow = await prisma.planCommitment.findFirst({
      where: { id: input.relatedCommitmentId, childId: child.id },
    });
    if (!relatedRow) {
      throw new PlanError("Bağlı iş bulunamadı.", "NOT_FOUND");
    }
    if (relatedRow.type === "COURSE") {
      throw new PlanError("Hazırlık adımı yalnızca ödev veya sınava bağlanabilir.", "VALIDATION");
    }
    relatedCommitmentId = relatedRow.id;
    related = relatedRow;
  }

  let relatedGoalId: string | null = null;
  if (input.relatedGoalId) {
    const goal = await prisma.planGoal.findFirst({
      where: { id: input.relatedGoalId, childId: child.id },
    });
    if (!goal) throw new PlanError("Hedef bulunamadı.", "NOT_FOUND");
    relatedGoalId = goal.id;
  }

  const plannedIso = formatCalendarDate(plannedDate);
  const deadline = related ? commitmentDeadlineIso(related) : null;
  if (
    plannedIso &&
    deadline &&
    compareCalendarDates(plannedIso, deadline) > 0 &&
    !input.allowAfterDeadline
  ) {
    throw new PlanError(
      "Bu adım ilgili tarihten sonraya planlandı. Onaylarsan yine de kaydedebilirsin.",
      "DEADLINE_WARNING",
      { plannedDate: plannedIso, relatedDeadline: deadline },
    );
  }

  const created = await prisma.planStudyStep.create({
    data: {
      childId: child.id,
      title,
      subject,
      plannedDate,
      estimatedMinutes,
      reminderLocalTime,
      relatedCommitmentId,
      relatedGoalId,
      clientRequestId,
    },
    include: stepInclude,
  });
  const { syncStudyStepReminder } = await import("@/lib/reminder");
  await syncStudyStepReminder(created.id);
  return toStudyStepView(created);
}

export async function updateCommitment(input: {
  childUserId: string;
  id: string;
  expectedRevision: number;
  title?: string;
  subject?: string;
  dueDate?: string | null;
  eventDate?: string | null;
  eventTimeLocal?: string | null;
  dateUnknown?: boolean;
}) {
  const child = await requireChildProfile(input.childUserId);
  const existing = await prisma.planCommitment.findFirst({
    where: { id: input.id, childId: child.id },
    include: { _count: { select: { studySteps: true } } },
  });
  if (!existing) throw new PlanError("Kayıt bulunamadı.", "NOT_FOUND");
  if (existing.revision !== input.expectedRevision) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }

  const title =
    input.title !== undefined ? clampText(input.title, PLAN_TITLE_MAX) : existing.title;
  if (!title) throw new PlanError("Başlık gerekli.", "VALIDATION");
  const subject =
    input.subject !== undefined
      ? clampText(input.subject, PLAN_SUBJECT_MAX)
      : existing.subject;

  let dueDate = existing.dueDate;
  let eventDate = existing.eventDate;
  let eventTimeLocal = existing.eventTimeLocal;

  if (existing.type === "HOMEWORK" && (input.dueDate !== undefined || input.dateUnknown)) {
    dueDate = input.dateUnknown ? null : parseOptionalCalendar(input.dueDate, "Teslim tarihi");
  }
  if (
    (existing.type === "EXAM" || existing.type === "COURSE") &&
    (input.eventDate !== undefined || input.eventTimeLocal !== undefined)
  ) {
    if (input.eventDate !== undefined) {
      eventDate = parseOptionalCalendar(input.eventDate, "Tarih");
      if (!eventDate) throw new PlanError("Tarih gerekli.", "VALIDATION");
    }
    if (input.eventTimeLocal !== undefined) {
      const time =
        typeof input.eventTimeLocal === "string" ? input.eventTimeLocal.trim() : "";
      if (time && !isValidEventTimeLocal(time)) {
        throw new PlanError("Saat HH:mm biçiminde olmalı.", "VALIDATION");
      }
      eventTimeLocal = time || null;
    }
  }

  const updated = await prisma.planCommitment.updateMany({
    where: { id: existing.id, revision: input.expectedRevision },
    data: {
      title,
      subject,
      dueDate,
      eventDate,
      eventTimeLocal,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }
  const fresh = await prisma.planCommitment.findUniqueOrThrow({
    where: { id: existing.id },
    include: { _count: { select: { studySteps: true } } },
  });
  return toCommitmentView(fresh);
}

export async function updateStudyStep(input: {
  childUserId: string;
  id: string;
  expectedRevision: number;
  title?: string;
  subject?: string;
  plannedDate?: string | null;
  estimatedMinutes?: number | null;
  reminderLocalTime?: string | null;
  relatedCommitmentId?: string | null;
  allowAfterDeadline?: boolean;
}) {
  const child = await requireChildProfile(input.childUserId);
  const existing = await prisma.planStudyStep.findFirst({
    where: { id: input.id, childId: child.id },
    include: stepInclude,
  });
  if (!existing) throw new PlanError("Kayıt bulunamadı.", "NOT_FOUND");
  if (existing.revision !== input.expectedRevision) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }

  const title =
    input.title !== undefined ? clampText(input.title, PLAN_TITLE_MAX) : existing.title;
  if (!title) throw new PlanError("Başlık gerekli.", "VALIDATION");
  const subject =
    input.subject !== undefined
      ? clampText(input.subject, PLAN_SUBJECT_MAX)
      : existing.subject;
  const plannedDate =
    input.plannedDate !== undefined
      ? parseOptionalCalendar(input.plannedDate, "Planlanan gün")
      : existing.plannedDate;
  const estimatedMinutes =
    input.estimatedMinutes !== undefined
      ? parseOptionalMinutes(input.estimatedMinutes)
      : existing.estimatedMinutes;
  const reminderLocalTime =
    input.reminderLocalTime !== undefined
      ? parseOptionalReminderTime(input.reminderLocalTime, plannedDate)
      : parseOptionalReminderTime(existing.reminderLocalTime, plannedDate);

  let relatedCommitmentId = existing.relatedCommitmentId;
  if (input.relatedCommitmentId !== undefined) {
    if (!input.relatedCommitmentId) {
      relatedCommitmentId = null;
    } else {
      const relatedRow = await prisma.planCommitment.findFirst({
        where: { id: input.relatedCommitmentId, childId: child.id },
      });
      if (!relatedRow) throw new PlanError("Bağlı iş bulunamadı.", "NOT_FOUND");
      if (relatedRow.type === "COURSE") {
        throw new PlanError(
          "Hazırlık adımı yalnızca ödev veya sınava bağlanabilir.",
          "VALIDATION",
        );
      }
      relatedCommitmentId = relatedRow.id;
    }
  }

  const related =
    relatedCommitmentId
      ? await prisma.planCommitment.findFirst({
          where: { id: relatedCommitmentId, childId: child.id },
        })
      : null;

  const plannedIso = formatCalendarDate(plannedDate);
  const deadline = related ? commitmentDeadlineIso(related) : null;
  if (
    plannedIso &&
    deadline &&
    compareCalendarDates(plannedIso, deadline) > 0 &&
    !input.allowAfterDeadline
  ) {
    throw new PlanError(
      "Bu adım ilgili tarihten sonraya planlandı. Onaylarsan yine de kaydedebilirsin.",
      "DEADLINE_WARNING",
      { plannedDate: plannedIso, relatedDeadline: deadline },
    );
  }

  const updated = await prisma.planStudyStep.updateMany({
    where: { id: existing.id, revision: input.expectedRevision },
    data: {
      title,
      subject,
      plannedDate,
      estimatedMinutes,
      reminderLocalTime,
      relatedCommitmentId,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }
  const fresh = await prisma.planStudyStep.findUniqueOrThrow({
    where: { id: existing.id },
    include: stepInclude,
  });
  const { syncStudyStepReminder } = await import("@/lib/reminder");
  await syncStudyStepReminder(fresh.id);
  return toStudyStepView(fresh);
}

export async function setCommitmentCompletion(input: {
  childUserId: string;
  id: string;
  expectedRevision: number;
  completed: boolean;
}) {
  const child = await requireChildProfile(input.childUserId);
  const existing = await prisma.planCommitment.findFirst({
    where: { id: input.id, childId: child.id },
  });
  if (!existing) throw new PlanError("Kayıt bulunamadı.", "NOT_FOUND");

  const wantCompleted = input.completed;
  const isCompleted = Boolean(existing.completedAt);
  // Idempotent: already in desired state → success (retry-safe; no flip).
  if (wantCompleted === isCompleted) {
    return toCommitmentView({
      ...existing,
      _count: {
        studySteps: await prisma.planStudyStep.count({
          where: { relatedCommitmentId: existing.id },
        }),
      },
    });
  }
  if (existing.revision !== input.expectedRevision) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }

  const updated = await prisma.planCommitment.updateMany({
    where: { id: existing.id, revision: input.expectedRevision },
    data: {
      completedAt: wantCompleted ? new Date() : null,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }
  const fresh = await prisma.planCommitment.findUniqueOrThrow({
    where: { id: existing.id },
    include: { _count: { select: { studySteps: true } } },
  });
  return toCommitmentView(fresh);
}

export async function setStudyStepStatus(input: {
  childUserId: string;
  id: string;
  expectedRevision: number;
  status: StudyStepStatus;
}) {
  if (!STUDY_STEP_STATUSES.includes(input.status)) {
    throw new PlanError("Geçersiz durum.", "VALIDATION");
  }
  const child = await requireChildProfile(input.childUserId);
  const existing = await prisma.planStudyStep.findFirst({
    where: { id: input.id, childId: child.id },
    include: stepInclude,
  });
  if (!existing) throw new PlanError("Kayıt bulunamadı.", "NOT_FOUND");

  // Idempotent: already in desired state → success (retry-safe; no flip).
  // Repeating DONE preserves the existing completedAt timestamp.
  if (existing.status === input.status) {
    return toStudyStepView(existing);
  }
  if (existing.revision !== input.expectedRevision) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }

  const enteringDone = input.status === "DONE";
  const leavingDone = existing.status === "DONE" && input.status !== "DONE";

  const updated = await prisma.planStudyStep.updateMany({
    where: { id: existing.id, revision: input.expectedRevision },
    data: {
      status: input.status,
      ...(enteringDone ? { completedAt: new Date() } : {}),
      ...(leavingDone ? { completedAt: null } : {}),
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }
  const fresh = await prisma.planStudyStep.findUniqueOrThrow({
    where: { id: existing.id },
    include: stepInclude,
  });
  const { syncStudyStepReminder } = await import("@/lib/reminder");
  await syncStudyStepReminder(fresh.id);
  return toStudyStepView(fresh);
}

/** @deprecated Prefer setStudyStepStatus — maps completed → DONE / TODO. */
export async function setStudyStepCompletion(input: {
  childUserId: string;
  id: string;
  expectedRevision: number;
  completed: boolean;
}) {
  return setStudyStepStatus({
    childUserId: input.childUserId,
    id: input.id,
    expectedRevision: input.expectedRevision,
    status: input.completed ? "DONE" : "TODO",
  });
}

export async function rescheduleStudyStep(input: {
  childUserId: string;
  id: string;
  expectedRevision: number;
  plannedDate: string | null;
  allowAfterDeadline?: boolean;
}) {
  return updateStudyStep({
    childUserId: input.childUserId,
    id: input.id,
    expectedRevision: input.expectedRevision,
    plannedDate: input.plannedDate,
    allowAfterDeadline: input.allowAfterDeadline,
  });
}

export async function deleteCommitment(input: {
  childUserId: string;
  id: string;
  linkedSteps: "keep" | "delete";
}) {
  const child = await requireChildProfile(input.childUserId);
  const existing = await prisma.planCommitment.findFirst({
    where: { id: input.id, childId: child.id },
  });
  if (!existing) throw new PlanError("Kayıt bulunamadı.", "NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    if (input.linkedSteps === "delete") {
      await tx.planStudyStep.deleteMany({
        where: { relatedCommitmentId: existing.id, childId: child.id },
      });
    } else {
      await tx.planStudyStep.updateMany({
        where: { relatedCommitmentId: existing.id, childId: child.id },
        data: { relatedCommitmentId: null },
      });
    }
    await tx.planCommitment.delete({ where: { id: existing.id } });
  });
  return { ok: true as const };
}

export async function deleteStudyStep(input: { childUserId: string; id: string }) {
  const child = await requireChildProfile(input.childUserId);
  const existing = await prisma.planStudyStep.findFirst({
    where: { id: input.id, childId: child.id },
  });
  if (!existing) throw new PlanError("Kayıt bulunamadı.", "NOT_FOUND");
  const { cancelStudyStepReminders } = await import("@/lib/reminder");
  await cancelStudyStepReminders(existing.id);
  await prisma.planStudyStep.delete({ where: { id: existing.id } });
  return { ok: true as const };
}

export async function getNextStudyStepForToday(childUserId: string) {
  const child = await requireChildProfile(childUserId);
  const today = calendarDateInTimeZone(child.timeZone);
  const todayDate = parseCalendarDate(today);

  const steps = await prisma.planStudyStep.findMany({
    where: {
      childId: child.id,
      status: { in: OPEN_STATUSES },
      plannedDate: todayDate,
    },
    include: stepInclude,
    orderBy: [{ estimatedMinutes: "asc" }, { createdAt: "asc" }],
  });
  if (steps.length === 0) return null;
  const inProgress = steps.find((s) => s.status === "IN_PROGRESS");
  return toStudyStepView(inProgress ?? steps[0]!);
}

export async function listMissedStudySteps(childUserId: string) {
  const child = await requireChildProfile(childUserId);
  const today = calendarDateInTimeZone(child.timeZone);
  const todayDate = parseCalendarDate(today);
  const steps = await prisma.planStudyStep.findMany({
    where: {
      childId: child.id,
      status: { in: OPEN_STATUSES },
      plannedDate: { lt: todayDate },
    },
    include: stepInclude,
    orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
    take: 20,
  });
  return steps.map(toStudyStepView);
}

export async function getWeekPlanForChild(childUserId: string, weekStartIso?: string) {
  const child = await requireChildProfile(childUserId);
  const today = calendarDateInTimeZone(child.timeZone);
  const monday = startOfWeekMonday(weekStartIso || today);
  const sunday = addCalendarDays(monday, 6);
  const days = weekDatesFromMonday(monday);
  const from = parseCalendarDate(monday);
  const to = parseCalendarDate(sunday);

  const [commitments, steps, unscheduled] = await Promise.all([
    prisma.planCommitment.findMany({
      where: {
        childId: child.id,
        OR: [
          { dueDate: { gte: from, lte: to } },
          { eventDate: { gte: from, lte: to } },
        ],
      },
      include: { _count: { select: { studySteps: true } } },
      orderBy: [{ eventDate: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.planStudyStep.findMany({
      where: {
        childId: child.id,
        plannedDate: { gte: from, lte: to },
      },
      include: stepInclude,
      orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.planStudyStep.findMany({
      where: {
        childId: child.id,
        plannedDate: null,
        status: { in: OPEN_STATUSES },
      },
      include: stepInclude,
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
  ]);

  const dayViews = days.map((date) => {
    const dayCommitments = commitments
      .filter((c) => {
        const d =
          c.type === "HOMEWORK"
            ? formatCalendarDate(c.dueDate)
            : formatCalendarDate(c.eventDate);
        return d === date;
      })
      .map(toCommitmentView);
    const daySteps = steps
      .filter((s) => formatCalendarDate(s.plannedDate) === date)
      .map(toStudyStepView);
    const openSteps = daySteps.filter((s) => s.status !== "DONE");
    const studyMinutes = openSteps.reduce(
      (sum, s) => sum + (s.estimatedMinutes ?? 0),
      0,
    );
    return {
      date,
      commitments: dayCommitments,
      studySteps: daySteps,
      studyStepCount: openSteps.length,
      studyMinutes,
    };
  });

  return {
    timeZone: child.timeZone,
    today,
    weekStart: monday,
    weekEnd: sunday,
    days: dayViews,
    unscheduled: unscheduled.map(toStudyStepView),
    missed: await listMissedStudySteps(childUserId),
  };
}

export async function listCommitmentsForLinking(childUserId: string) {
  const child = await requireChildProfile(childUserId);
  const rows = await prisma.planCommitment.findMany({
    where: {
      childId: child.id,
      type: { in: ["HOMEWORK", "EXAM"] },
      completedAt: null,
    },
    include: { _count: { select: { studySteps: true } } },
    orderBy: { updatedAt: "desc" },
    take: 40,
  });
  return rows.map(toCommitmentView);
}

export async function getCommitment(childUserId: string, id: string) {
  const child = await requireChildProfile(childUserId);
  const row = await prisma.planCommitment.findFirst({
    where: { id, childId: child.id },
    include: { _count: { select: { studySteps: true } } },
  });
  if (!row) throw new PlanError("Kayıt bulunamadı.", "NOT_FOUND");
  const steps = await prisma.planStudyStep.findMany({
    where: { relatedCommitmentId: id, childId: child.id },
    include: stepInclude,
    orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
  });
  return { commitment: toCommitmentView(row), studySteps: steps.map(toStudyStepView) };
}

export async function getStudyStep(childUserId: string, id: string) {
  const child = await requireChildProfile(childUserId);
  const row = await prisma.planStudyStep.findFirst({
    where: { id, childId: child.id },
    include: stepInclude,
  });
  if (!row) throw new PlanError("Kayıt bulunamadı.", "NOT_FOUND");
  return toStudyStepView(row);
}

/** Parent read-only plan for their family children — never includes journal fields. */
export async function getParentWeekPlan(parentUserId: string, weekStartIso?: string) {
  const membership = await prisma.familyMembership.findUnique({
    where: { userId: parentUserId },
  });
  if (!membership) {
    return { children: [] as const };
  }

  const children = await prisma.childProfile.findMany({
    where: { familyId: membership.familyId },
    orderBy: { createdAt: "asc" },
  });

  const result = [];
  for (const child of children) {
    if (!child.userId) continue;
    const week = await getWeekPlanForChild(child.userId, weekStartIso);
    result.push({
      childId: child.id,
      childDisplayName: child.displayName,
      timeZone: child.timeZone,
      today: week.today,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      days: week.days,
      unscheduled: week.unscheduled,
      missed: week.missed,
    });
  }
  return { children: result };
}
