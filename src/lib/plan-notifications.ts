import type { AppNotificationKind, PlanCommitmentType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

async function activeGuardianUserIds(childId: string, db: Db) {
  const guardians = await db.childGuardianAccess.findMany({
    where: { childId, revokedAt: null },
    select: { userId: true },
  });
  return guardians.map((g) => g.userId);
}

async function createPerGuardian(input: {
  childId: string;
  childDisplayName: string;
  kind: AppNotificationKind;
  uniquenessKeyPrefix: string;
  title: string;
  body: string;
  href: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  const recipientIds = await activeGuardianUserIds(input.childId, db);
  let created = 0;
  for (const userId of recipientIds) {
    const uniquenessKey = `${input.uniquenessKeyPrefix}:${userId}`;
    try {
      await db.appNotification.create({
        data: {
          recipientUserId: userId,
          kind: input.kind,
          uniquenessKey,
          title: input.title,
          body: input.body,
          href: input.href,
          childId: input.childId,
        },
      });
      created += 1;
    } catch (error) {
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

function commitmentKindLabel(type: PlanCommitmentType): string {
  switch (type) {
    case "HOMEWORK":
      return "ödev";
    case "EXAM":
      return "sınav";
    case "COURSE":
      return "kurs / etkinlik";
    default:
      return "kayıt";
  }
}

export async function notifyGuardiansOfPlanRecordCreated(input: {
  childId: string;
  childDisplayName: string;
  kind: "commitment" | "study_step";
  recordId: string;
  type?: PlanCommitmentType;
  title: string;
  db?: Db;
}) {
  const name = input.childDisplayName.trim() || "Çocuğun";
  const what =
    input.kind === "study_step"
      ? "çalışma adımı"
      : commitmentKindLabel(input.type ?? "HOMEWORK");
  const href =
    input.kind === "study_step"
      ? `/veli/plan/adim/${input.recordId}`
      : `/veli/plan/is/${input.recordId}`;
  return createPerGuardian({
    childId: input.childId,
    childDisplayName: name,
    kind: "PLAN_RECORD_CREATED",
    uniquenessKeyPrefix: `plan_created:${input.kind}:${input.recordId}`,
    title: `${name} plana yeni bir ${what} ekledi.`,
    body: "Kaydı açıp detayına bakabilirsin.",
    href,
    db: input.db,
  });
}

export async function notifyGuardiansOfPlanScheduleChanged(input: {
  childId: string;
  childDisplayName: string;
  kind: "commitment" | "study_step";
  recordId: string;
  /** Stable id for this meaningful change (e.g. revision after update). */
  changeId: string;
  db?: Db;
}) {
  const name = input.childDisplayName.trim() || "Çocuğun";
  const href =
    input.kind === "study_step"
      ? `/veli/plan/adim/${input.recordId}`
      : `/veli/plan/is/${input.recordId}`;
  return createPerGuardian({
    childId: input.childId,
    childDisplayName: name,
    kind: "PLAN_SCHEDULE_CHANGED",
    uniquenessKeyPrefix: `plan_schedule:${input.kind}:${input.recordId}:${input.changeId}`,
    title: `${name} bir plan tarihini değiştirdi.`,
    body: "Güncel kaydı açabilirsin.",
    href,
    db: input.db,
  });
}

export async function notifyGuardiansOfPlanStepCompleted(input: {
  childId: string;
  childDisplayName: string;
  studyStepId: string;
  title: string;
  /** Distinct per DONE transition; reopen + DONE again may notify again. */
  completionEventId?: string;
  db?: Db;
}) {
  const name = input.childDisplayName.trim() || "Çocuğun";
  const eventId = input.completionEventId ?? `done:${input.studyStepId}:${Date.now()}`;
  return createPerGuardian({
    childId: input.childId,
    childDisplayName: name,
    kind: "PLAN_STEP_COMPLETED",
    uniquenessKeyPrefix: `plan_step_done:${eventId}`,
    title: `${name} bir çalışma adımını tamamladı.`,
    body: "Adımı açıp bakabilirsin.",
    href: `/veli/plan/adim/${input.studyStepId}`,
    db: input.db,
  });
}

/**
 * Touch existing completion notifications' updatedAt / body when reflection is saved.
 * Does not create a new item or reset readAt.
 */
export async function touchPlanStepCompletionNotification(input: {
  studyStepId: string;
  hasReflection: boolean;
}) {
  const href = `/veli/plan/adim/${input.studyStepId}`;
  await prisma.appNotification.updateMany({
    where: {
      kind: "PLAN_STEP_COMPLETED",
      href,
      invalidatedAt: null,
    },
    data: {
      body: input.hasReflection
        ? "Adımı ve çocuğun notunu açabilirsin."
        : "Adımı açıp bakabilirsin.",
      updatedAt: new Date(),
    },
  });
}

/** Soft-hide notifications whose target detail was deleted. */
export async function invalidateNotificationsForHref(href: string) {
  await prisma.appNotification.updateMany({
    where: { href, invalidatedAt: null },
    data: { invalidatedAt: new Date() },
  });
}

export async function notifyGuardiansOfPlanExtractBatch(input: {
  childId: string;
  childDisplayName: string;
  applyRequestId: string;
  createdCount: number;
  db?: Db;
}) {
  if (input.createdCount < 1) return { created: 0 };
  const name = input.childDisplayName.trim() || "Çocuğun";
  const count = input.createdCount;
  const title =
    count === 1
      ? `${name} planına 1 yeni kayıt ekledi.`
      : `${name} planına ${count} yeni kayıt ekledi.`;
  return createPerGuardian({
    childId: input.childId,
    childDisplayName: name,
    kind: "PLAN_EXTRACT_BATCH",
    uniquenessKeyPrefix: `plan_extract:${input.applyRequestId}`,
    title,
    body: "Haftalık planda yeni kayıtları görebilirsin.",
    href: "/veli/plan",
    db: input.db,
  });
}
