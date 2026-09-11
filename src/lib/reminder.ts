import { randomUUID } from "crypto";
import type { ReminderOccurrenceStatus } from "@prisma/client";
import { diaryDateForTimeZone } from "@/lib/journal";
import { calendarDateInTimeZone, formatCalendarDate, parseCalendarDate, addCalendarDays } from "@/lib/plan-dates";
import { prisma } from "@/lib/prisma";
import { getPushAdapter, REMINDER_COPY, type PushAdapter } from "@/lib/push";
import {
  REMINDER_BATCH_SIZE,
  REMINDER_CLAIM_LEASE_MS,
  REMINDER_DAILY_CAP,
  REMINDER_GRACE_MS,
  REMINDER_MAX_ATTEMPTS,
  reminderNow,
} from "@/lib/reminder-clock";
import {
  isValidLocalTime,
  resolveDeliveryInstant,
} from "@/lib/reminder-time";
import { AuthorizationError } from "@/lib/session";

export class ReminderError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "FORBIDDEN" | "NOT_CONFIGURED",
  ) {
    super(message);
    this.name = "ReminderError";
  }
}

export type ReminderPreferencesView = {
  journalReminderEnabled: boolean;
  journalReminderLocalTime: string;
  studyRemindersEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  revision: number;
  pushConfigured: boolean;
};

async function requireChild(childUserId: string) {
  const child = await prisma.childProfile.findUnique({
    where: { userId: childUserId },
  });
  if (!child) throw new AuthorizationError("Çocuk profili bulunamadı.");
  return child;
}

function defaultPrefsView(revision = 1): ReminderPreferencesView {
  return {
    journalReminderEnabled: false,
    journalReminderLocalTime: "19:00",
    studyRemindersEnabled: false,
    quietHoursStart: "21:00",
    quietHoursEnd: "08:00",
    revision,
    pushConfigured: getPushAdapter().isConfigured(),
  };
}

export async function getReminderPreferences(
  childUserId: string,
): Promise<ReminderPreferencesView> {
  const child = await requireChild(childUserId);
  const row = await prisma.childReminderPreferences.findUnique({
    where: { childId: child.id },
  });
  if (!row) return defaultPrefsView();
  return {
    journalReminderEnabled: row.journalReminderEnabled,
    journalReminderLocalTime: row.journalReminderLocalTime,
    studyRemindersEnabled: row.studyRemindersEnabled,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    revision: row.revision,
    pushConfigured: getPushAdapter().isConfigured(),
  };
}

export async function updateReminderPreferences(input: {
  childUserId: string;
  expectedRevision: number;
  journalReminderEnabled?: boolean;
  journalReminderLocalTime?: string;
  studyRemindersEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
}): Promise<ReminderPreferencesView> {
  const child = await requireChild(input.childUserId);
  let row = await prisma.childReminderPreferences.findUnique({
    where: { childId: child.id },
  });
  if (!row) {
    row = await prisma.childReminderPreferences.create({
      data: { childId: child.id },
    });
  }
  if (row.revision !== input.expectedRevision) {
    throw new ReminderError(
      "Ayarlar başka bir yerde güncellendi. Yenileyip tekrar dene.",
      "CONFLICT",
    );
  }

  const journalReminderLocalTime =
    input.journalReminderLocalTime ?? row.journalReminderLocalTime;
  const quietHoursStart = input.quietHoursStart ?? row.quietHoursStart;
  const quietHoursEnd = input.quietHoursEnd ?? row.quietHoursEnd;
  for (const [label, value] of [
    ["Günlük hatırlatma saati", journalReminderLocalTime],
    ["Sessiz saat başlangıcı", quietHoursStart],
    ["Sessiz saat bitişi", quietHoursEnd],
  ] as const) {
    if (!isValidLocalTime(value)) {
      throw new ReminderError(`${label} HH:mm olmalı.`, "VALIDATION");
    }
  }

  const updated = await prisma.childReminderPreferences.updateMany({
    where: { id: row.id, revision: input.expectedRevision },
    data: {
      journalReminderEnabled:
        input.journalReminderEnabled ?? row.journalReminderEnabled,
      journalReminderLocalTime,
      studyRemindersEnabled:
        input.studyRemindersEnabled ?? row.studyRemindersEnabled,
      quietHoursStart,
      quietHoursEnd,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new ReminderError(
      "Ayarlar başka bir yerde güncellendi. Yenileyip tekrar dene.",
      "CONFLICT",
    );
  }

  const fresh = await prisma.childReminderPreferences.findUniqueOrThrow({
    where: { childId: child.id },
  });

  // Turning study reminders off cancels pending study occurrences.
  if (!fresh.studyRemindersEnabled) {
    await prisma.reminderOccurrence.updateMany({
      where: {
        childId: child.id,
        kind: "STUDY_STEP",
        status: { in: ["PENDING", "CLAIMED"] },
      },
      data: { status: "CANCELLED" },
    });
  }
  if (!fresh.journalReminderEnabled) {
    await prisma.reminderOccurrence.updateMany({
      where: {
        childId: child.id,
        kind: "JOURNAL",
        status: { in: ["PENDING", "CLAIMED"] },
      },
      data: { status: "CANCELLED" },
    });
  } else {
    await materializeJournalReminderForChild(child.id);
  }

  if (fresh.studyRemindersEnabled) {
    await rematerializeStudyRemindersForChild(child.id);
  }

  return getReminderPreferences(input.childUserId);
}

export async function registerPushSubscription(input: {
  childUserId: string;
  sessionId: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}) {
  const child = await requireChild(input.childUserId);
  if (!child.userId) throw new ReminderError("Oturum geçersiz.", "FORBIDDEN");
  if (!getPushAdapter().isConfigured()) {
    throw new ReminderError("Bildirimler şu an yapılandırılmamış.", "NOT_CONFIGURED");
  }
  const endpoint = input.endpoint.trim();
  if (!endpoint.startsWith("https://") || endpoint.length > 2000) {
    throw new ReminderError("Geçersiz abonelik.", "VALIDATION");
  }
  if (!input.p256dh.trim() || !input.auth.trim()) {
    throw new ReminderError("Geçersiz abonelik anahtarları.", "VALIDATION");
  }

  // One endpoint actively owned by at most one child.
  const existing = await prisma.childPushSubscription.findUnique({
    where: { endpoint },
  });
  if (existing && existing.childId !== child.id && !existing.revokedAt) {
    await prisma.childPushSubscription.update({
      where: { id: existing.id },
      data: { revokedAt: reminderNow() },
    });
  }

  if (existing && existing.childId === child.id) {
    return prisma.childPushSubscription.update({
      where: { id: existing.id },
      data: {
        userId: child.userId,
        sessionId: input.sessionId,
        p256dh: input.p256dh.trim(),
        auth: input.auth.trim(),
        userAgent: (input.userAgent || "").slice(0, 300),
        revokedAt: null,
      },
    });
  }

  return prisma.childPushSubscription.create({
    data: {
      childId: child.id,
      userId: child.userId,
      sessionId: input.sessionId,
      endpoint,
      p256dh: input.p256dh.trim(),
      auth: input.auth.trim(),
      userAgent: (input.userAgent || "").slice(0, 300),
    },
  });
}

export async function revokePushSubscriptionsForChild(childId: string) {
  await prisma.childPushSubscription.updateMany({
    where: { childId, revokedAt: null },
    data: { revokedAt: reminderNow() },
  });
}

export async function revokePushSubscriptionsForUser(userId: string) {
  await prisma.childPushSubscription.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: reminderNow() },
  });
}

export async function revokePushSubscriptionsForSession(sessionId: string) {
  await prisma.childPushSubscription.updateMany({
    where: { sessionId, revokedAt: null },
    data: { revokedAt: reminderNow() },
  });
}

export async function listActivePushStatus(childUserId: string) {
  const child = await requireChild(childUserId);
  const count = await prisma.childPushSubscription.count({
    where: { childId: child.id, revokedAt: null },
  });
  return {
    deviceRegistered: count > 0,
    pushConfigured: getPushAdapter().isConfigured(),
    subscriptionCount: count,
  };
}

/** Non-empty saved narrative for child-local calendar day — no body returned. */
export async function childHasSavedJournalNarrativeForLocalDate(
  childId: string,
  localDate: string,
): Promise<boolean> {
  const diaryDate = parseCalendarDate(localDate);
  const entry = await prisma.journalEntry.findFirst({
    where: {
      childId,
      diaryDate,
      status: "SAVED",
      OR: [{ body: { not: "" } }, { originalBody: { not: "" } }],
    },
    select: { id: true, body: true, originalBody: true },
  });
  if (!entry) return false;
  return Boolean(entry.originalBody.trim() || entry.body.trim());
}

async function upsertOccurrence(input: {
  occurrenceKey: string;
  childId: string;
  kind: "JOURNAL" | "STUDY_STEP";
  studyStepId?: string | null;
  scheduledAt: Date;
  effectiveLocalDate: string;
  scheduleRevision: number;
}) {
  const existing = await prisma.reminderOccurrence.findUnique({
    where: { occurrenceKey: input.occurrenceKey },
  });
  if (existing) {
    if (existing.status === "SENT") return existing;
    const reopen =
      existing.status === "CANCELLED" ||
      existing.status === "EXPIRED" ||
      existing.status === "FAILED" ||
      existing.status === "SKIPPED";
    return prisma.reminderOccurrence.update({
      where: { id: existing.id },
      data: {
        scheduledAt: input.scheduledAt,
        effectiveLocalDate: parseCalendarDate(input.effectiveLocalDate),
        scheduleRevision: input.scheduleRevision,
        status: reopen ? "PENDING" : existing.status,
        studyStepId: input.studyStepId ?? null,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
      },
    });
  }
  return prisma.reminderOccurrence.create({
    data: {
      occurrenceKey: input.occurrenceKey,
      childId: input.childId,
      kind: input.kind,
      studyStepId: input.studyStepId ?? null,
      scheduledAt: input.scheduledAt,
      effectiveLocalDate: parseCalendarDate(input.effectiveLocalDate),
      scheduleRevision: input.scheduleRevision,
      status: "PENDING",
    },
  });
}

export async function materializeJournalReminderForChild(childId: string) {
  const child = await prisma.childProfile.findUniqueOrThrow({ where: { id: childId } });
  const prefs = await prisma.childReminderPreferences.findUnique({
    where: { childId },
  });
  if (!prefs?.journalReminderEnabled) return;

  const now = reminderNow();
  const localDate = calendarDateInTimeZone(child.timeZone, now);
  const resolved = resolveDeliveryInstant({
    timeZone: child.timeZone,
    localDate,
    localTime: prefs.journalReminderLocalTime,
    quietStart: prefs.quietHoursStart,
    quietEnd: prefs.quietHoursEnd,
  });
  if ("skip" in resolved) return;

  // If already past grace for today, materialize tomorrow instead.
  let targetDate = localDate;
  let scheduledAt = resolved.scheduledAt;
  if (scheduledAt.getTime() + REMINDER_GRACE_MS < now.getTime()) {
    targetDate = addCalendarDays(localDate, 1);
    const next = resolveDeliveryInstant({
      timeZone: child.timeZone,
      localDate: targetDate,
      localTime: prefs.journalReminderLocalTime,
      quietStart: prefs.quietHoursStart,
      quietEnd: prefs.quietHoursEnd,
    });
    if ("skip" in next) return;
    scheduledAt = next.scheduledAt;
  }

  await upsertOccurrence({
    occurrenceKey: `journal:${childId}:${targetDate}`,
    childId,
    kind: "JOURNAL",
    scheduledAt,
    effectiveLocalDate: targetDate,
    scheduleRevision: prefs.revision,
  });
}

export async function syncStudyStepReminder(stepId: string) {
  const step = await prisma.planStudyStep.findUnique({ where: { id: stepId } });
  if (!step) return;

  // Cancel pending for this step first when disabled / ineligible
  const cancelPending = async () => {
    await prisma.reminderOccurrence.updateMany({
      where: {
        studyStepId: stepId,
        status: { in: ["PENDING", "CLAIMED"] },
      },
      data: { status: "CANCELLED" },
    });
  };

  const prefs = await prisma.childReminderPreferences.findUnique({
    where: { childId: step.childId },
  });
  const child = await prisma.childProfile.findUniqueOrThrow({
    where: { id: step.childId },
  });

  if (
    !prefs?.studyRemindersEnabled ||
    !step.reminderLocalTime ||
    !step.plannedDate ||
    step.status === "DONE" ||
    step.status === "IN_PROGRESS"
  ) {
    await cancelPending();
    return;
  }

  const localDate = formatCalendarDate(step.plannedDate)!;
  const resolved = resolveDeliveryInstant({
    timeZone: child.timeZone,
    localDate,
    localTime: step.reminderLocalTime,
    quietStart: prefs.quietHoursStart,
    quietEnd: prefs.quietHoursEnd,
  });
  if ("skip" in resolved) {
    await cancelPending();
    return;
  }

  const now = reminderNow();
  // Do not create / restore past occurrences (reopen must not replay past)
  if (resolved.scheduledAt.getTime() + REMINDER_GRACE_MS < now.getTime()) {
    await cancelPending();
    return;
  }

  await upsertOccurrence({
    occurrenceKey: `step:${stepId}:${localDate}:${step.reminderLocalTime}`,
    childId: step.childId,
    kind: "STUDY_STEP",
    studyStepId: stepId,
    scheduledAt: resolved.scheduledAt,
    effectiveLocalDate: localDate,
    scheduleRevision: step.revision,
  });

  // Cancel other pending keys for this step (e.g. after reschedule)
  await prisma.reminderOccurrence.updateMany({
    where: {
      studyStepId: stepId,
      status: { in: ["PENDING", "CLAIMED"] },
      occurrenceKey: {
        not: `step:${stepId}:${localDate}:${step.reminderLocalTime}`,
      },
    },
    data: { status: "CANCELLED" },
  });
}

export async function rematerializeStudyRemindersForChild(childId: string) {
  const steps = await prisma.planStudyStep.findMany({
    where: {
      childId,
      reminderLocalTime: { not: null },
      plannedDate: { not: null },
      status: "TODO",
    },
    select: { id: true },
  });
  for (const s of steps) {
    await syncStudyStepReminder(s.id);
  }
}

export async function cancelStudyStepReminders(stepId: string) {
  await prisma.reminderOccurrence.updateMany({
    where: { studyStepId: stepId, status: { in: ["PENDING", "CLAIMED"] } },
    data: { status: "CANCELLED" },
  });
}

async function tryIncrementDailyCap(
  childId: string,
  localDate: string,
): Promise<boolean> {
  const date = parseCalendarDate(localDate);
  await prisma.$executeRaw`
    INSERT INTO "ReminderDayBucket" ("id", "childId", "localDate", "sentCount", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${childId}, ${date}, 0, NOW())
    ON CONFLICT ("childId", "localDate") DO NOTHING
  `;
  const updated = await prisma.reminderDayBucket.updateMany({
    where: {
      childId,
      localDate: date,
      sentCount: { lt: REMINDER_DAILY_CAP },
    },
    data: { sentCount: { increment: 1 } },
  });
  return updated.count === 1;
}

async function releaseDailyCap(childId: string, localDate: string) {
  const date = parseCalendarDate(localDate);
  await prisma.reminderDayBucket.updateMany({
    where: {
      childId,
      localDate: date,
      sentCount: { gt: 0 },
    },
    data: { sentCount: { decrement: 1 } },
  });
}

async function recheckOccurrence(
  occurrenceId: string,
): Promise<
  | {
      ok: true;
      copy: (typeof REMINDER_COPY)["journal"] | (typeof REMINDER_COPY)["study"];
      localDate: string;
    }
  | { ok: false; status: ReminderOccurrenceStatus; reason: string }
> {
  const occ = await prisma.reminderOccurrence.findUnique({
    where: { id: occurrenceId },
    include: {
      studyStep: true,
      child: {
        include: { reminderPreferences: true },
      },
    },
  });
  if (!occ) return { ok: false, status: "CANCELLED", reason: "missing" };
  const prefs = occ.child.reminderPreferences;
  const localDate = formatCalendarDate(occ.effectiveLocalDate)!;

  if (occ.kind === "JOURNAL") {
    if (!prefs?.journalReminderEnabled) {
      return { ok: false, status: "CANCELLED", reason: "prefs-off" };
    }
    if (await childHasSavedJournalNarrativeForLocalDate(occ.childId, localDate)) {
      return { ok: false, status: "SKIPPED", reason: "journal-exists" };
    }
    return { ok: true, copy: REMINDER_COPY.journal, localDate };
  }

  if (!prefs?.studyRemindersEnabled) {
    return { ok: false, status: "CANCELLED", reason: "prefs-off" };
  }
  const step = occ.studyStep;
  if (!step) return { ok: false, status: "CANCELLED", reason: "step-missing" };
  if (step.status === "DONE" || step.status === "IN_PROGRESS") {
    return { ok: false, status: "SKIPPED", reason: "step-status" };
  }
  if (!step.reminderLocalTime || !step.plannedDate) {
    return { ok: false, status: "CANCELLED", reason: "no-schedule" };
  }
  if (step.revision !== occ.scheduleRevision) {
    // Stale schedule — cancel; rematerialization should have created a new key
    return { ok: false, status: "CANCELLED", reason: "stale-revision" };
  }
  return { ok: true, copy: REMINDER_COPY.study, localDate };
}

export type ProcessRemindersResult = {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  expired: number;
};

export async function processDueReminders(input?: {
  push?: PushAdapter;
  batchSize?: number;
}): Promise<ProcessRemindersResult> {
  const push = input?.push ?? getPushAdapter();
  const batchSize = input?.batchSize ?? REMINDER_BATCH_SIZE;
  const now = reminderNow();
  const result: ProcessRemindersResult = {
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    expired: 0,
  };

  // Materialize journal reminders for children with prefs enabled (bounded).
  const journalPrefs = await prisma.childReminderPreferences.findMany({
    where: { journalReminderEnabled: true },
    take: 100,
    select: { childId: true },
  });
  for (const p of journalPrefs) {
    await materializeJournalReminderForChild(p.childId);
  }

  // Release expired leases
  await prisma.reminderOccurrence.updateMany({
    where: {
      status: "CLAIMED",
      claimExpiresAt: { lt: now },
    },
    data: { status: "PENDING", claimToken: null, claimedAt: null, claimExpiresAt: null },
  });

  const due = await prisma.reminderOccurrence.findMany({
    where: {
      status: "PENDING",
      scheduledAt: { lte: now },
    },
    orderBy: { scheduledAt: "asc" },
    take: batchSize,
  });

  for (const occ of due) {
    const age = now.getTime() - occ.scheduledAt.getTime();
    if (age > REMINDER_GRACE_MS) {
      await prisma.reminderOccurrence.update({
        where: { id: occ.id },
        data: { status: "EXPIRED", lastError: "grace-exceeded" },
      });
      result.expired += 1;
      continue;
    }

    const claimToken = randomUUID();
    const claimed = await prisma.reminderOccurrence.updateMany({
      where: { id: occ.id, status: "PENDING" },
      data: {
        status: "CLAIMED",
        claimToken,
        claimedAt: now,
        claimExpiresAt: new Date(now.getTime() + REMINDER_CLAIM_LEASE_MS),
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) continue;
    result.claimed += 1;

    const check = await recheckOccurrence(occ.id);
    if (!check.ok) {
      await prisma.reminderOccurrence.updateMany({
        where: { id: occ.id, claimToken, status: "CLAIMED" },
        data: { status: check.status, lastError: check.reason, claimToken: null },
      });
      result.skipped += 1;
      continue;
    }

    const subscriptions = await prisma.childPushSubscription.findMany({
      where: { childId: occ.childId, revokedAt: null },
    });

    if (subscriptions.length === 0) {
      await prisma.reminderOccurrence.updateMany({
        where: { id: occ.id, claimToken, status: "CLAIMED" },
        data: {
          status: "SKIPPED",
          lastError: "no-device",
          claimToken: null,
        },
      });
      result.skipped += 1;
      continue;
    }

    const capped = await tryIncrementDailyCap(occ.childId, check.localDate);
    if (!capped) {
      await prisma.reminderOccurrence.updateMany({
        where: { id: occ.id, claimToken, status: "CLAIMED" },
        data: { status: "SKIPPED", lastError: "daily-cap", claimToken: null },
      });
      result.skipped += 1;
      continue;
    }

    let anyAccepted = false;
    let hardFail = false;
    for (const sub of subscriptions) {
      const existingDelivery = await prisma.reminderDelivery.findUnique({
        where: {
          occurrenceId_subscriptionId: {
            occurrenceId: occ.id,
            subscriptionId: sub.id,
          },
        },
      });
      if (existingDelivery?.acceptedAt) {
        anyAccepted = true;
        continue;
      }

      const sendResult = await push.send(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        {
          title: check.copy.title,
          body: check.copy.body,
          tag: check.copy.tag,
          url: check.copy.url,
        },
      );

      if (sendResult.status === "accepted") {
        anyAccepted = true;
        await prisma.reminderDelivery.upsert({
          where: {
            occurrenceId_subscriptionId: {
              occurrenceId: occ.id,
              subscriptionId: sub.id,
            },
          },
          create: {
            occurrenceId: occ.id,
            subscriptionId: sub.id,
            acceptedAt: reminderNow(),
          },
          update: { acceptedAt: reminderNow(), failedAt: null, errorCode: "" },
        });
      } else if (sendResult.status === "gone") {
        await prisma.childPushSubscription.update({
          where: { id: sub.id },
          data: { revokedAt: reminderNow() },
        });
        await prisma.reminderDelivery.upsert({
          where: {
            occurrenceId_subscriptionId: {
              occurrenceId: occ.id,
              subscriptionId: sub.id,
            },
          },
          create: {
            occurrenceId: occ.id,
            subscriptionId: sub.id,
            failedAt: reminderNow(),
            errorCode: "GONE",
          },
          update: { failedAt: reminderNow(), errorCode: "GONE" },
        });
      } else {
        hardFail = true;
        await prisma.reminderDelivery.upsert({
          where: {
            occurrenceId_subscriptionId: {
              occurrenceId: occ.id,
              subscriptionId: sub.id,
            },
          },
          create: {
            occurrenceId: occ.id,
            subscriptionId: sub.id,
            failedAt: reminderNow(),
            errorCode: sendResult.code,
          },
          update: { failedAt: reminderNow(), errorCode: sendResult.code },
        });
      }
    }

    if (anyAccepted) {
      await prisma.reminderOccurrence.updateMany({
        where: { id: occ.id, claimToken, status: "CLAIMED" },
        data: { status: "SENT", claimToken: null, lastError: "" },
      });
      result.sent += 1;
    } else if (
      hardFail &&
      occ.attemptCount + 1 < REMINDER_MAX_ATTEMPTS
    ) {
      await releaseDailyCap(occ.childId, check.localDate);
      await prisma.reminderOccurrence.updateMany({
        where: { id: occ.id, claimToken, status: "CLAIMED" },
        data: {
          status: "PENDING",
          claimToken: null,
          claimedAt: null,
          claimExpiresAt: null,
          lastError: "retry",
        },
      });
      result.failed += 1;
    } else {
      await releaseDailyCap(occ.childId, check.localDate);
      await prisma.reminderOccurrence.updateMany({
        where: { id: occ.id, claimToken, status: "CLAIMED" },
        data: {
          status: "FAILED",
          claimToken: null,
          lastError: "max-attempts-or-no-accept",
        },
      });
      result.failed += 1;
    }
  }

  return result;
}

export async function sendTestPushToChild(input: {
  childUserId: string;
  sessionId: string | null;
}) {
  const child = await requireChild(input.childUserId);
  const push = getPushAdapter();
  if (!push.isConfigured()) {
    throw new ReminderError("Bildirimler şu an yapılandırılmamış.", "NOT_CONFIGURED");
  }
  const subs = await prisma.childPushSubscription.findMany({
    where: {
      childId: child.id,
      revokedAt: null,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    },
  });
  if (subs.length === 0) {
    throw new ReminderError(
      "Bu cihazda kayıtlı bildirim aboneliği yok.",
      "VALIDATION",
    );
  }
  let accepted = 0;
  for (const sub of subs) {
    const result = await push.send(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      {
        title: REMINDER_COPY.test.title,
        body: REMINDER_COPY.test.body,
        tag: REMINDER_COPY.test.tag,
        url: REMINDER_COPY.test.url,
      },
    );
    if (result.status === "accepted") accepted += 1;
    if (result.status === "gone") {
      await prisma.childPushSubscription.update({
        where: { id: sub.id },
        data: { revokedAt: reminderNow() },
      });
    }
  }
  if (accepted === 0) {
    throw new ReminderError("Deneme bildirimi gönderilemedi.", "VALIDATION");
  }
  return { ok: true as const, accepted };
}

/** Ensure journal diary date helper is available for tests without pulling journal private text. */
export function todayDiaryDateForChild(timeZone: string, at = reminderNow()) {
  return diaryDateForTimeZone(timeZone, at);
}
