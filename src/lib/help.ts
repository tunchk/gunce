import type {
  HelpOfferStatus,
  HelpRequestStatus,
  HelpType,
  PlanCommitmentType,
  Prisma,
} from "@prisma/client";
import { helpRequestStatusLabel, helpTypeLabel, HELP_TYPES } from "@/lib/help-labels";
import type {
  HelpOfferView,
  HelpPlanItemView,
  HelpRequestView,
  HelpSessionView,
} from "@/lib/help-types";
import { prisma } from "@/lib/prisma";
import { formatCalendarDate, parseCalendarDate } from "@/lib/plan-dates";
import { AuthorizationError } from "@/lib/session";

export { HELP_TYPES, helpTypeLabel, helpRequestStatusLabel } from "@/lib/help-labels";
export type {
  HelpOfferView,
  HelpPlanItemView,
  HelpRequestView,
  HelpSessionView,
} from "@/lib/help-types";

export class HelpError extends Error {
  constructor(
    message: string,
    public code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "VALIDATION"
      | "CONFLICT"
      | "GONE" = "VALIDATION",
  ) {
    super(message);
    this.name = "HelpError";
  }
}

export const HELP_NOTE_MAX = 280;
export const HELP_OFFER_NOTE_MAX = 160;

const ACTIVE_REQUEST_STATUSES: HelpRequestStatus[] = [
  "OPEN",
  "OFFERED",
  "ACCEPTED",
];

function normalizeNote(raw: string | undefined, max: number): string {
  return (raw ?? "").trim().slice(0, max);
}

function isValidTimeLocal(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

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
    throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
  }
  return access;
}

const requestInclude = {
  studyStep: { select: { id: true, title: true, subject: true, plannedDate: true } },
  commitment: {
    select: {
      id: true,
      title: true,
      subject: true,
      type: true,
      dueDate: true,
      eventDate: true,
    },
  },
  offers: {
    include: {
      guardian: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
  child: { select: { id: true, displayName: true, timeZone: true, userId: true } },
} satisfies Prisma.HelpRequestInclude;

function toPlanItem(row: {
  studyStepId: string | null;
  commitmentId: string | null;
  studyStep: {
    id: string;
    title: string;
    subject: string;
    plannedDate: Date | null;
  } | null;
  commitment: {
    id: string;
    title: string;
    subject: string;
    type: PlanCommitmentType;
    dueDate: Date | null;
    eventDate: Date | null;
  } | null;
}): HelpPlanItemView {
  if (row.studyStep) {
    return {
      kind: "study_step",
      id: row.studyStep.id,
      title: row.studyStep.title,
      subject: row.studyStep.subject,
      date: formatCalendarDate(row.studyStep.plannedDate),
    };
  }
  if (row.commitment) {
    const date =
      formatCalendarDate(row.commitment.eventDate) ||
      formatCalendarDate(row.commitment.dueDate);
    return {
      kind: "commitment",
      id: row.commitment.id,
      title: row.commitment.title,
      subject: row.commitment.subject,
      type: row.commitment.type,
      date,
    };
  }
  throw new HelpError("Plan kaydı bulunamadı.", "NOT_FOUND");
}

function toOfferView(o: {
  id: string;
  requestId: string;
  guardianUserId: string;
  proposedDate: Date;
  proposedTimeLocal: string;
  note: string;
  status: HelpOfferStatus;
  createdAt: Date;
  guardian: { id: string; name: string };
}): HelpOfferView {
  return {
    id: o.id,
    requestId: o.requestId,
    guardianUserId: o.guardianUserId,
    guardianName: o.guardian.name.trim() || "Veli",
    proposedDate: formatCalendarDate(o.proposedDate)!,
    proposedTimeLocal: o.proposedTimeLocal,
    note: o.note,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
  };
}

function toRequestView(
  row: Prisma.HelpRequestGetPayload<{ include: typeof requestInclude }>,
): HelpRequestView {
  const lifecycleNotice =
    (row.status === "OPEN" || row.status === "OFFERED") && row.sessionInvalidatedAt
      ? "Yardım planı güncellendi. İstersen başka bir teklifi seç veya yeni teklif bekle."
      : null;
  return {
    id: row.id,
    childId: row.childId,
    childDisplayName: row.child.displayName,
    helpType: row.helpType,
    helpTypeLabel: helpTypeLabel(row.helpType),
    note: row.note,
    status: row.status,
    statusLabel: helpRequestStatusLabel(row.status),
    planItem: toPlanItem(row),
    acceptedOfferId: row.acceptedOfferId,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    offers: row.offers.map(toOfferView),
    lifecycleNotice,
  };
}

/** Scheduled help session derived from an accepted offer (no separate calendar entity). */
function toSessionView(
  row: Prisma.HelpRequestGetPayload<{ include: typeof requestInclude }>,
): HelpSessionView | null {
  if (row.status !== "ACCEPTED" && row.status !== "COMPLETED") return null;
  const accepted = row.offers.find((o) => o.id === row.acceptedOfferId);
  if (!accepted) return null;
  return {
    requestId: row.id,
    offerId: accepted.id,
    childId: row.childId,
    childDisplayName: row.child.displayName,
    guardianUserId: accepted.guardianUserId,
    guardianName: accepted.guardian.name.trim() || "Veli",
    helpType: row.helpType,
    helpTypeLabel: helpTypeLabel(row.helpType),
    planItem: toPlanItem(row),
    proposedDate: formatCalendarDate(accepted.proposedDate)!,
    proposedTimeLocal: accepted.proposedTimeLocal,
    status: row.status === "COMPLETED" ? "COMPLETED" : "ACCEPTED",
  };
}

export async function createHelpRequest(input: {
  childUserId: string;
  studyStepId?: string | null;
  commitmentId?: string | null;
  helpType: HelpType;
  note?: string;
}) {
  const child = await requireChildProfile(input.childUserId);
  const studyStepId = input.studyStepId?.trim() || null;
  const commitmentId = input.commitmentId?.trim() || null;
  if (Boolean(studyStepId) === Boolean(commitmentId)) {
    throw new HelpError("Bir çalışma adımı veya ödev/sınav seç.", "VALIDATION");
  }
  if (!HELP_TYPES.includes(input.helpType)) {
    throw new HelpError("Yardım türü geçersiz.", "VALIDATION");
  }
  const note = normalizeNote(input.note, HELP_NOTE_MAX);

  if (studyStepId) {
    const step = await prisma.planStudyStep.findFirst({
      where: { id: studyStepId, childId: child.id },
    });
    if (!step) throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
  } else if (commitmentId) {
    const c = await prisma.planCommitment.findFirst({
      where: { id: commitmentId, childId: child.id },
    });
    if (!c) throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
  }

  const existing = await prisma.helpRequest.findFirst({
    where: {
      childId: child.id,
      status: { in: ACTIVE_REQUEST_STATUSES },
      ...(studyStepId ? { studyStepId } : { commitmentId }),
    },
  });
  if (existing) {
    throw new HelpError(
      "Bu kayıt için zaten açık bir yardım isteğin var.",
      "CONFLICT",
    );
  }

  const created = await prisma.helpRequest.create({
    data: {
      childId: child.id,
      studyStepId,
      commitmentId,
      helpType: input.helpType,
      note,
      status: "OPEN",
    },
    include: requestInclude,
  });

  const { notifyGuardiansOfHelpRequest } = await import("@/lib/help-notifications");
  await notifyGuardiansOfHelpRequest({
    requestId: created.id,
    childId: child.id,
    childDisplayName: child.displayName,
    planTitle: toPlanItem(created).title,
    helpType: created.helpType,
  });

  return toRequestView(created);
}

export async function listChildHelpRequests(childUserId: string) {
  const child = await requireChildProfile(childUserId);
  const rows = await prisma.helpRequest.findMany({
    where: { childId: child.id },
    include: requestInclude,
    orderBy: [{ updatedAt: "desc" }],
    take: 50,
  });
  return rows.map(toRequestView);
}

export async function getChildHelpRequest(childUserId: string, requestId: string) {
  const child = await requireChildProfile(childUserId);
  const row = await prisma.helpRequest.findFirst({
    where: { id: requestId, childId: child.id },
    include: requestInclude,
  });
  if (!row) throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
  return toRequestView(row);
}

export async function getActiveHelpForPlanItem(input: {
  childUserId: string;
  studyStepId?: string | null;
  commitmentId?: string | null;
}) {
  const child = await requireChildProfile(input.childUserId);
  const studyStepId = input.studyStepId?.trim() || null;
  const commitmentId = input.commitmentId?.trim() || null;
  if (!studyStepId && !commitmentId) return null;
  const row = await prisma.helpRequest.findFirst({
    where: {
      childId: child.id,
      status: { in: ACTIVE_REQUEST_STATUSES },
      ...(studyStepId ? { studyStepId } : { commitmentId }),
    },
    include: requestInclude,
    orderBy: { createdAt: "desc" },
  });
  return row ? toRequestView(row) : null;
}

export async function cancelHelpRequest(input: {
  childUserId: string;
  requestId: string;
}) {
  const child = await requireChildProfile(input.childUserId);
  const row = await prisma.helpRequest.findFirst({
    where: { id: input.requestId, childId: child.id },
    include: requestInclude,
  });
  if (!row) throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
  if (row.status === "CANCELLED" || row.status === "COMPLETED") {
    throw new HelpError("Bu istek artık iptal edilemez.", "GONE");
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.helpOffer.updateMany({
      where: { requestId: row.id, status: "PENDING" },
      data: { status: "DECLINED" },
    });
    return tx.helpRequest.update({
      where: { id: row.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        sessionInvalidatedAt: null,
      },
      include: requestInclude,
    });
  });

  const { notifyHelpRequestCancelled } = await import("@/lib/help-notifications");
  await notifyHelpRequestCancelled({
    requestId: updated.id,
    childId: child.id,
    childDisplayName: child.displayName,
    planTitle: toPlanItem(updated).title,
    previousStatus: row.status,
    acceptedGuardianUserId:
      row.offers.find((o) => o.id === row.acceptedOfferId)?.guardianUserId ?? null,
    offerGuardianIds: row.offers
      .filter((o) => o.status === "PENDING" || o.status === "ACCEPTED")
      .map((o) => o.guardianUserId),
  });

  return toRequestView(updated);
}

export async function completeHelpRequest(input: {
  childUserId: string;
  requestId: string;
}) {
  const child = await requireChildProfile(input.childUserId);
  const row = await prisma.helpRequest.findFirst({
    where: { id: input.requestId, childId: child.id },
    include: requestInclude,
  });
  if (!row) throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
  if (row.status !== "ACCEPTED") {
    throw new HelpError("Yalnızca planlanmış yardım tamamlanabilir.", "VALIDATION");
  }

  const updated = await prisma.helpRequest.update({
    where: { id: row.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      sessionInvalidatedAt: null,
    },
    include: requestInclude,
  });

  const { notifyHelpSessionCompleted } = await import("@/lib/help-notifications");
  const accepted = row.offers.find((o) => o.id === row.acceptedOfferId);
  if (accepted) {
    await notifyHelpSessionCompleted({
      requestId: row.id,
      childId: child.id,
      childDisplayName: child.displayName,
      planTitle: toPlanItem(row).title,
      guardianUserId: accepted.guardianUserId,
    });
  }

  return toRequestView(updated);
}

export async function acceptHelpOffer(input: {
  childUserId: string;
  requestId: string;
  offerId: string;
}) {
  const child = await requireChildProfile(input.childUserId);

  return prisma.$transaction(async (tx) => {
    const row = await tx.helpRequest.findFirst({
      where: { id: input.requestId, childId: child.id },
      include: requestInclude,
    });
    if (!row) throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
    if (row.status === "CANCELLED") {
      throw new HelpError("Bu istek iptal edilmiş.", "GONE");
    }
    if (row.status === "COMPLETED") {
      throw new HelpError("Bu yardım tamamlanmış.", "GONE");
    }
    if (row.status === "ACCEPTED") {
      throw new HelpError("Zaten bir teklif kabul edildi.", "CONFLICT");
    }

    const offer = row.offers.find((o) => o.id === input.offerId);
    if (!offer || offer.status !== "PENDING") {
      throw new HelpError("Teklif bulunamadı.", "NOT_FOUND");
    }

    const access = await tx.childGuardianAccess.findFirst({
      where: {
        childId: child.id,
        userId: offer.guardianUserId,
        revokedAt: null,
      },
    });
    if (!access) {
      throw new HelpError("Bu teklif artık geçerli değil.", "GONE");
    }

    await tx.helpOffer.update({
      where: { id: offer.id },
      data: { status: "ACCEPTED" },
    });
    // Keep other PENDING offers so the child can pick another if this guardian later withdraws.
    const updated = await tx.helpRequest.update({
      where: { id: row.id },
      data: {
        status: "ACCEPTED",
        acceptedOfferId: offer.id,
        sessionInvalidatedAt: null,
      },
      include: requestInclude,
    });

    const { notifyHelpOfferAccepted } = await import("@/lib/help-notifications");
    await notifyHelpOfferAccepted({
      requestId: row.id,
      childId: child.id,
      childDisplayName: child.displayName,
      planTitle: toPlanItem(row).title,
      guardianUserId: offer.guardianUserId,
      proposedDate: formatCalendarDate(offer.proposedDate)!,
      proposedTimeLocal: offer.proposedTimeLocal,
      db: tx,
    });

    return toRequestView(updated);
  });
}

export async function editHelpOffer(input: {
  parentUserId: string;
  offerId: string;
  proposedDate: string;
  proposedTimeLocal: string;
}) {
  const offer = await prisma.helpOffer.findUnique({
    where: { id: input.offerId },
    include: {
      request: { include: requestInclude },
      guardian: { select: { id: true, name: true } },
    },
  });
  if (!offer || offer.guardianUserId !== input.parentUserId) {
    throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
  }
  await requireGuardianAccess(input.parentUserId, offer.request.childId);

  if (
    offer.request.status === "CANCELLED" ||
    offer.request.status === "COMPLETED"
  ) {
    throw new HelpError("Bu istek artık güncellenemez.", "GONE");
  }
  if (offer.status !== "PENDING") {
    throw new HelpError("Yalnızca bekleyen teklif düzenlenebilir.", "VALIDATION");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.proposedDate)) {
    throw new HelpError("Geçerli bir tarih seç.", "VALIDATION");
  }
  const time = input.proposedTimeLocal.trim();
  if (!isValidTimeLocal(time)) {
    throw new HelpError("Saat HH:mm formatında olmalı.", "VALIDATION");
  }

  const updated = await prisma.helpOffer.update({
    where: { id: offer.id },
    data: {
      proposedDate: parseCalendarDate(input.proposedDate),
      proposedTimeLocal: time,
    },
    include: { guardian: { select: { id: true, name: true } } },
  });

  const childUserId = offer.request.child.userId;
  if (childUserId) {
    const { notifyChildOfHelpOfferUpdated } = await import("@/lib/help-notifications");
    await notifyChildOfHelpOfferUpdated({
      requestId: offer.requestId,
      childUserId,
      childId: offer.request.childId,
      guardianName: updated.guardian.name,
      planTitle: toPlanItem(offer.request).title,
      proposedDate: input.proposedDate,
      proposedTimeLocal: time,
      offerId: offer.id,
    });
  }

  return toOfferView({ ...updated, requestId: offer.requestId });
}

/**
 * Guardian whose offer was accepted can no longer help.
 * Clears acceptance and reopens the request for other pending offers (or OPEN).
 */
export async function cancelAcceptedHelpByGuardian(input: {
  parentUserId: string;
  requestId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.helpRequest.findUnique({
      where: { id: input.requestId },
      include: requestInclude,
    });
    if (!row) throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
    await requireGuardianAccess(input.parentUserId, row.childId);

    if (row.status !== "ACCEPTED" || !row.acceptedOfferId) {
      throw new HelpError("Planlanmış bir yardım yok.", "VALIDATION");
    }
    const accepted = row.offers.find((o) => o.id === row.acceptedOfferId);
    if (!accepted || accepted.guardianUserId !== input.parentUserId) {
      throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
    }

    await tx.helpOffer.update({
      where: { id: accepted.id },
      data: { status: "WITHDRAWN", withdrawnAt: new Date() },
    });

    const pendingLeft = await tx.helpOffer.count({
      where: { requestId: row.id, status: "PENDING" },
    });
    const nextStatus: HelpRequestStatus = pendingLeft > 0 ? "OFFERED" : "OPEN";

    const updated = await tx.helpRequest.update({
      where: { id: row.id },
      data: {
        acceptedOfferId: null,
        status: nextStatus,
        sessionInvalidatedAt: new Date(),
      },
      include: requestInclude,
    });

    const { notifyAcceptedHelpCancelledByGuardian } = await import(
      "@/lib/help-notifications"
    );
    const childUserId = row.child.userId;
    if (childUserId) {
      await notifyAcceptedHelpCancelledByGuardian({
        requestId: row.id,
        childUserId,
        childId: row.childId,
        guardianName: accepted.guardian.name,
        planTitle: toPlanItem(row).title,
        reopenedAs: nextStatus,
        acceptedOfferId: accepted.id,
        db: tx,
      });
    }

    return toRequestView(updated);
  });
}

/**
 * When the underlying plan item's schedule changes, reopen any ACCEPTED help
 * so Bugün/Haftam never keep a silently stale accepted session.
 */
export async function reopenAcceptedHelpDueToPlanChange(input: {
  studyStepId?: string | null;
  commitmentId?: string | null;
}) {
  const studyStepId = input.studyStepId?.trim() || null;
  const commitmentId = input.commitmentId?.trim() || null;
  if (!studyStepId && !commitmentId) return { reopened: 0 };

  const rows = await prisma.helpRequest.findMany({
    where: {
      status: "ACCEPTED",
      ...(studyStepId ? { studyStepId } : { commitmentId }),
    },
    include: requestInclude,
  });

  let reopened = 0;
  for (const row of rows) {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.helpRequest.findUnique({
        where: { id: row.id },
        include: requestInclude,
      });
      if (!fresh || fresh.status !== "ACCEPTED" || !fresh.acceptedOfferId) return;

      const acceptedOfferId = fresh.acceptedOfferId!;
      const accepted = fresh.offers.find((o) => o.id === acceptedOfferId);
      if (accepted && accepted.status === "ACCEPTED") {
        await tx.helpOffer.update({
          where: { id: accepted.id },
          data: { status: "WITHDRAWN", withdrawnAt: new Date() },
        });
      }

      const pendingLeft = await tx.helpOffer.count({
        where: { requestId: fresh.id, status: "PENDING" },
      });
      const nextStatus: HelpRequestStatus = pendingLeft > 0 ? "OFFERED" : "OPEN";

      await tx.helpRequest.update({
        where: { id: fresh.id },
        data: {
          acceptedOfferId: null,
          status: nextStatus,
          sessionInvalidatedAt: new Date(),
        },
      });

      const { notifyHelpReopenedDueToPlanChange } = await import(
        "@/lib/help-notifications"
      );
      const childUserId = fresh.child.userId;
      const guardianIds = fresh.offers
        .filter((o) => o.status === "PENDING" || o.id === acceptedOfferId)
        .map((o) => o.guardianUserId);
      if (accepted) guardianIds.push(accepted.guardianUserId);
      if (childUserId) {
        await notifyHelpReopenedDueToPlanChange({
          requestId: fresh.id,
          childUserId,
          childId: fresh.childId,
          planTitle: toPlanItem(fresh).title,
          guardianUserIds: [...new Set(guardianIds)],
          acceptedOfferId,
          db: tx,
        });
      }
    });
    reopened += 1;
  }
  return { reopened };
}

export async function createHelpOffer(input: {
  parentUserId: string;
  requestId: string;
  proposedDate: string;
  proposedTimeLocal: string;
  note?: string;
}) {
  const row = await prisma.helpRequest.findUnique({
    where: { id: input.requestId },
    include: requestInclude,
  });
  if (!row) throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
  await requireGuardianAccess(input.parentUserId, row.childId);

  if (row.status === "CANCELLED" || row.status === "COMPLETED") {
    throw new HelpError("Bu istek artık teklif kabul etmiyor.", "GONE");
  }
  if (row.status === "ACCEPTED") {
    throw new HelpError("Bu istek için zaten yardım planlandı.", "CONFLICT");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.proposedDate)) {
    throw new HelpError("Geçerli bir tarih seç.", "VALIDATION");
  }
  const time = input.proposedTimeLocal.trim();
  if (!isValidTimeLocal(time)) {
    throw new HelpError("Saat HH:mm formatında olmalı.", "VALIDATION");
  }
  const note = normalizeNote(input.note, HELP_OFFER_NOTE_MAX);
  const proposedDate = parseCalendarDate(input.proposedDate);

  const existing = await prisma.helpOffer.findUnique({
    where: {
      requestId_guardianUserId: {
        requestId: row.id,
        guardianUserId: input.parentUserId,
      },
    },
  });
  if (existing && existing.status === "PENDING") {
    throw new HelpError("Bu istek için zaten bir teklifin var.", "CONFLICT");
  }

  const offer = await prisma.$transaction(async (tx) => {
    let created;
    if (existing) {
      created = await tx.helpOffer.update({
        where: { id: existing.id },
        data: {
          proposedDate,
          proposedTimeLocal: time,
          note,
          status: "PENDING",
          withdrawnAt: null,
        },
        include: { guardian: { select: { id: true, name: true } } },
      });
    } else {
      created = await tx.helpOffer.create({
        data: {
          requestId: row.id,
          guardianUserId: input.parentUserId,
          proposedDate,
          proposedTimeLocal: time,
          note,
          status: "PENDING",
        },
        include: { guardian: { select: { id: true, name: true } } },
      });
    }

    if (row.status === "OPEN") {
      await tx.helpRequest.update({
        where: { id: row.id },
        data: { status: "OFFERED" },
      });
    }

    return created;
  });

  const { notifyChildOfHelpOffer } = await import("@/lib/help-notifications");
  const childUserId = row.child.userId;
  if (childUserId) {
    await notifyChildOfHelpOffer({
      requestId: row.id,
      childUserId,
      childId: row.childId,
      guardianName: offer.guardian.name,
      planTitle: toPlanItem(row).title,
      proposedDate: input.proposedDate,
      proposedTimeLocal: time,
      offerId: offer.id,
    });
  }

  return toOfferView({ ...offer, requestId: row.id });
}

export async function withdrawHelpOffer(input: {
  parentUserId: string;
  offerId: string;
}) {
  const offer = await prisma.helpOffer.findUnique({
    where: { id: input.offerId },
    include: {
      request: { include: requestInclude },
      guardian: { select: { id: true, name: true } },
    },
  });
  if (!offer || offer.guardianUserId !== input.parentUserId) {
    throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
  }
  await requireGuardianAccess(input.parentUserId, offer.request.childId);

  if (offer.status !== "PENDING") {
    throw new HelpError("Yalnızca bekleyen teklif geri alınabilir.", "VALIDATION");
  }

  await prisma.$transaction(async (tx) => {
    await tx.helpOffer.update({
      where: { id: offer.id },
      data: { status: "WITHDRAWN", withdrawnAt: new Date() },
    });
    const pendingLeft = await tx.helpOffer.count({
      where: { requestId: offer.requestId, status: "PENDING" },
    });
    if (offer.request.status === "OFFERED" && pendingLeft === 0) {
      await tx.helpRequest.update({
        where: { id: offer.requestId },
        data: { status: "OPEN" },
      });
    }
  });

  const childUserId = offer.request.child.userId;
  if (childUserId) {
    const { notifyChildOfHelpOfferWithdrawn } = await import("@/lib/help-notifications");
    await notifyChildOfHelpOfferWithdrawn({
      requestId: offer.requestId,
      childUserId,
      childId: offer.request.childId,
      guardianName: offer.guardian.name,
      planTitle: toPlanItem(offer.request).title,
      offerId: offer.id,
    });
  }

  return { ok: true as const };
}

export async function listParentHelpInbox(parentUserId: string, childId?: string) {
  const accesses = await prisma.childGuardianAccess.findMany({
    where: {
      userId: parentUserId,
      revokedAt: null,
      ...(childId ? { childId } : {}),
    },
    select: { childId: true },
  });
  const childIds = accesses.map((a) => a.childId);
  if (childIds.length === 0) {
    return {
      waiting: [] as HelpRequestView[],
      myOffers: [] as HelpRequestView[],
      scheduled: [] as HelpSessionView[],
      history: [] as HelpRequestView[],
    };
  }

  const rows = await prisma.helpRequest.findMany({
    where: { childId: { in: childIds } },
    include: requestInclude,
    orderBy: [{ updatedAt: "desc" }],
    take: 80,
  });

  const waiting = rows
    .filter((r) => r.status === "OPEN" || r.status === "OFFERED")
    .filter((r) => !r.offers.some((o) => o.guardianUserId === parentUserId && o.status === "PENDING"))
    .map(toRequestView);

  const myOffers = rows
    .filter((r) =>
      r.offers.some(
        (o) => o.guardianUserId === parentUserId && o.status === "PENDING",
      ),
    )
    .map(toRequestView);

  const scheduled = rows
    .filter((r) => r.status === "ACCEPTED")
    .map(toSessionView)
    .filter((s): s is HelpSessionView => Boolean(s))
    .filter((s) => s.guardianUserId === parentUserId);

  const history = rows
    .filter((r) => r.status === "COMPLETED" || r.status === "CANCELLED")
    .slice(0, 20)
    .map(toRequestView);

  return { waiting, myOffers, scheduled, history };
}

export async function getParentHelpRequest(parentUserId: string, requestId: string) {
  const row = await prisma.helpRequest.findUnique({
    where: { id: requestId },
    include: requestInclude,
  });
  if (!row) throw new HelpError("Kayıt bulunamadı.", "NOT_FOUND");
  await requireGuardianAccess(parentUserId, row.childId);
  return toRequestView(row);
}

export async function listChildHelpSessions(
  childUserId: string,
  opts?: { fromDate?: string; toDate?: string },
) {
  const child = await requireChildProfile(childUserId);
  return listAcceptedHelpSessionsForChildId(child.id, opts);
}

/** Active accepted/completed help sessions for a child (caller must authorize). */
export async function listAcceptedHelpSessionsForChildId(
  childId: string,
  opts?: { fromDate?: string; toDate?: string },
) {
  const rows = await prisma.helpRequest.findMany({
    where: {
      childId,
      status: { in: ["ACCEPTED", "COMPLETED"] },
    },
    include: requestInclude,
    orderBy: { updatedAt: "desc" },
    take: 40,
  });
  return rows
    .map(toSessionView)
    .filter((s): s is HelpSessionView => Boolean(s))
    .filter((s) => {
      if (opts?.fromDate && s.proposedDate < opts.fromDate) return false;
      if (opts?.toDate && s.proposedDate > opts.toDate) return false;
      return true;
    });
}

export async function listParentHelpSessions(
  parentUserId: string,
  opts?: { childId?: string; fromDate?: string; toDate?: string },
) {
  const inbox = await listParentHelpInbox(parentUserId, opts?.childId);
  return inbox.scheduled.filter((s) => {
    if (opts?.fromDate && s.proposedDate < opts.fromDate) return false;
    if (opts?.toDate && s.proposedDate > opts.toDate) return false;
    return true;
  });
}

export async function listOpenHelpRequestCountForParent(
  parentUserId: string,
  childId: string,
) {
  await requireGuardianAccess(parentUserId, childId);
  return prisma.helpRequest.count({
    where: {
      childId,
      status: { in: ["OPEN", "OFFERED"] },
    },
  });
}
