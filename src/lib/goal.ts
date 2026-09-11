import type { PlanGoalStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/lib/session";
import {
  formatCalendarDate,
  parseCalendarDate,
} from "@/lib/plan-dates";
import {
  PlanError,
  PLAN_TITLE_MAX,
  toStudyStepViewFromRow,
  type StudyStepView,
} from "@/lib/plan";

export const GOAL_TITLE_MAX = 200;
export const GOAL_DESCRIPTION_MAX = 1000;
export const GOAL_STATUSES = ["ACTIVE", "ACHIEVED", "ARCHIVED"] as const;
export type GoalLifecycleStatus = (typeof GOAL_STATUSES)[number];

function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
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

async function requireChildProfile(childUserId: string) {
  const child = await prisma.childProfile.findUnique({
    where: { userId: childUserId },
  });
  if (!child) throw new AuthorizationError("Çocuk profili bulunamadı.");
  return child;
}

const goalStepInclude = {
  relatedCommitment: {
    select: { title: true, type: true, dueDate: true, eventDate: true },
  },
  relatedGoal: {
    select: { id: true, title: true },
  },
} satisfies Prisma.PlanStudyStepInclude;

export type GoalProgress = {
  doneCount: number;
  totalCount: number;
  /** Fraction 0–1 when totalCount > 0; null when no steps (avoid fake 100%). */
  ratio: number | null;
  label: string;
};

export type GoalView = {
  id: string;
  title: string;
  description: string;
  targetDate: string | null;
  status: GoalLifecycleStatus;
  revision: number;
  progress: GoalProgress;
};

export type GoalDetailView = GoalView & {
  studySteps: StudyStepView[];
};

function progressFromSteps(
  steps: { status: string }[],
): GoalProgress {
  const totalCount = steps.length;
  const doneCount = steps.filter((s) => s.status === "DONE").length;
  if (totalCount === 0) {
    return {
      doneCount: 0,
      totalCount: 0,
      ratio: null,
      label: "Henüz adım yok",
    };
  }
  return {
    doneCount,
    totalCount,
    ratio: doneCount / totalCount,
    label: `${doneCount} / ${totalCount} adım tamamlandı`,
  };
}

function toGoalView(
  g: {
    id: string;
    title: string;
    description: string;
    targetDate: Date | null;
    status: PlanGoalStatus;
    revision: number;
    studySteps: { status: string }[];
  },
): GoalView {
  return {
    id: g.id,
    title: g.title,
    description: g.description,
    targetDate: formatCalendarDate(g.targetDate),
    status: g.status,
    revision: g.revision,
    progress: progressFromSteps(g.studySteps),
  };
}

export async function createGoal(input: {
  childUserId: string;
  title: string;
  description?: string;
  targetDate?: string | null;
  clientRequestId?: string | null;
}) {
  const child = await requireChildProfile(input.childUserId);
  const clientRequestId = input.clientRequestId?.trim() || null;
  if (clientRequestId) {
    const existing = await prisma.planGoal.findUnique({
      where: { clientRequestId },
      include: { studySteps: { select: { status: true } } },
    });
    if (existing) {
      if (existing.childId !== child.id) {
        throw new PlanError("Bu istek başka bir kayda ait.", "CONFLICT");
      }
      return toGoalView(existing);
    }
  }

  const title = clampText(input.title, GOAL_TITLE_MAX);
  if (!title) throw new PlanError("Başlık gerekli.", "VALIDATION");
  const description = clampText(input.description ?? "", GOAL_DESCRIPTION_MAX);
  const targetDate = parseOptionalCalendar(input.targetDate, "Hedef tarihi");

  const created = await prisma.planGoal.create({
    data: {
      childId: child.id,
      title,
      description,
      targetDate,
      clientRequestId,
    },
    include: { studySteps: { select: { status: true } } },
  });
  return toGoalView(created);
}

export async function updateGoal(input: {
  childUserId: string;
  id: string;
  expectedRevision: number;
  title?: string;
  description?: string;
  targetDate?: string | null;
}) {
  const child = await requireChildProfile(input.childUserId);
  const existing = await prisma.planGoal.findFirst({
    where: { id: input.id, childId: child.id },
  });
  if (!existing) throw new PlanError("Hedef bulunamadı.", "NOT_FOUND");
  if (existing.revision !== input.expectedRevision) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }

  const title =
    input.title !== undefined ? clampText(input.title, GOAL_TITLE_MAX) : existing.title;
  if (!title) throw new PlanError("Başlık gerekli.", "VALIDATION");
  const description =
    input.description !== undefined
      ? clampText(input.description, GOAL_DESCRIPTION_MAX)
      : existing.description;
  const targetDate =
    input.targetDate !== undefined
      ? parseOptionalCalendar(input.targetDate, "Hedef tarihi")
      : existing.targetDate;

  const updated = await prisma.planGoal.updateMany({
    where: { id: existing.id, revision: input.expectedRevision },
    data: {
      title,
      description,
      targetDate,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }
  return getGoalDetail(input.childUserId, existing.id);
}

export async function setGoalStatus(input: {
  childUserId: string;
  id: string;
  expectedRevision: number;
  status: GoalLifecycleStatus;
}) {
  if (!GOAL_STATUSES.includes(input.status)) {
    throw new PlanError("Geçersiz hedef durumu.", "VALIDATION");
  }
  const child = await requireChildProfile(input.childUserId);
  const existing = await prisma.planGoal.findFirst({
    where: { id: input.id, childId: child.id },
    include: { studySteps: { select: { status: true } } },
  });
  if (!existing) throw new PlanError("Hedef bulunamadı.", "NOT_FOUND");

  if (existing.status === input.status) {
    return toGoalView(existing);
  }
  if (existing.revision !== input.expectedRevision) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }

  const updated = await prisma.planGoal.updateMany({
    where: { id: existing.id, revision: input.expectedRevision },
    data: {
      status: input.status,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }
  return getGoalDetail(input.childUserId, existing.id);
}

export async function deleteGoal(input: { childUserId: string; id: string }) {
  const child = await requireChildProfile(input.childUserId);
  const existing = await prisma.planGoal.findFirst({
    where: { id: input.id, childId: child.id },
  });
  if (!existing) throw new PlanError("Hedef bulunamadı.", "NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    await tx.planStudyStep.updateMany({
      where: { relatedGoalId: existing.id, childId: child.id },
      data: { relatedGoalId: null },
    });
    await tx.planGoal.delete({ where: { id: existing.id } });
  });
  return { ok: true as const };
}

export async function listGoalsForChild(childUserId: string) {
  const child = await requireChildProfile(childUserId);
  const rows = await prisma.planGoal.findMany({
    where: { childId: child.id },
    include: { studySteps: { select: { status: true } } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
  const active = rows.filter((g) => g.status === "ACTIVE").map(toGoalView);
  const achieved = rows.filter((g) => g.status === "ACHIEVED").map(toGoalView);
  const archived = rows.filter((g) => g.status === "ARCHIVED").map(toGoalView);
  return { active, achieved, archived };
}

export async function getGoalDetail(childUserId: string, id: string): Promise<GoalDetailView> {
  const child = await requireChildProfile(childUserId);
  const row = await prisma.planGoal.findFirst({
    where: { id, childId: child.id },
    include: {
      studySteps: {
        include: goalStepInclude,
        orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!row) throw new PlanError("Hedef bulunamadı.", "NOT_FOUND");
  return {
    ...toGoalView(row),
    studySteps: row.studySteps.map(toStudyStepViewFromRow),
  };
}

export async function attachStepToGoal(input: {
  childUserId: string;
  goalId: string;
  studyStepId: string;
  /** Explicit confirm to move a step already linked to another goal. */
  allowMove?: boolean;
  expectedStepRevision: number;
}) {
  const child = await requireChildProfile(input.childUserId);
  const goal = await prisma.planGoal.findFirst({
    where: { id: input.goalId, childId: child.id },
  });
  if (!goal) throw new PlanError("Hedef bulunamadı.", "NOT_FOUND");

  const step = await prisma.planStudyStep.findFirst({
    where: { id: input.studyStepId, childId: child.id },
    include: goalStepInclude,
  });
  if (!step) throw new PlanError("Adım bulunamadı.", "NOT_FOUND");
  if (step.revision !== input.expectedStepRevision) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }

  if (step.relatedGoalId === goal.id) {
    return toStudyStepViewFromRow(step);
  }

  if (step.relatedGoalId && step.relatedGoalId !== goal.id) {
    if (!input.allowMove) {
      throw new PlanError(
        "Bu adım başka bir hedefe bağlı. Taşımak istediğine emin misin?",
        "CONFLICT",
        {
          code: "GOAL_ALREADY_LINKED",
          otherGoalId: step.relatedGoalId,
          otherGoalTitle: step.relatedGoal?.title ?? null,
        },
      );
    }
  }

  const updated = await prisma.planStudyStep.updateMany({
    where: { id: step.id, revision: input.expectedStepRevision },
    data: {
      relatedGoalId: goal.id,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }
  const fresh = await prisma.planStudyStep.findUniqueOrThrow({
    where: { id: step.id },
    include: goalStepInclude,
  });
  return toStudyStepViewFromRow(fresh);
}

export async function detachStepFromGoal(input: {
  childUserId: string;
  goalId: string;
  studyStepId: string;
  expectedStepRevision: number;
}) {
  const child = await requireChildProfile(input.childUserId);
  const goal = await prisma.planGoal.findFirst({
    where: { id: input.goalId, childId: child.id },
  });
  if (!goal) throw new PlanError("Hedef bulunamadı.", "NOT_FOUND");

  const step = await prisma.planStudyStep.findFirst({
    where: { id: input.studyStepId, childId: child.id },
    include: goalStepInclude,
  });
  if (!step) throw new PlanError("Adım bulunamadı.", "NOT_FOUND");
  if (step.relatedGoalId !== goal.id) {
    throw new PlanError("Bu adım bu hedefe bağlı değil.", "VALIDATION");
  }
  if (step.revision !== input.expectedStepRevision) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }

  const updated = await prisma.planStudyStep.updateMany({
    where: { id: step.id, revision: input.expectedStepRevision },
    data: {
      relatedGoalId: null,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new PlanError("Kayıt değişmiş. Yenileyip tekrar dene.", "CONFLICT");
  }
  const fresh = await prisma.planStudyStep.findUniqueOrThrow({
    where: { id: step.id },
    include: goalStepInclude,
  });
  return toStudyStepViewFromRow(fresh);
}

export async function listUnlinkedStudySteps(childUserId: string) {
  const child = await requireChildProfile(childUserId);
  const steps = await prisma.planStudyStep.findMany({
    where: { childId: child.id, relatedGoalId: null },
    include: goalStepInclude,
    orderBy: [{ updatedAt: "desc" }],
    take: 40,
  });
  return steps.map(toStudyStepViewFromRow);
}

/** Parent read-only goals for family children — never includes journal fields. */
export async function getParentGoals(parentUserId: string) {
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
    const listed = await listGoalsForChild(child.userId);
    const details: GoalDetailView[] = [];
    for (const g of [...listed.active, ...listed.achieved, ...listed.archived]) {
      details.push(await getGoalDetail(child.userId, g.id));
    }
    result.push({
      childId: child.id,
      childDisplayName: child.displayName,
      goals: details,
    });
  }
  return { children: result };
}
