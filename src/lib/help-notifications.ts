import { helpTypeLabel } from "@/lib/help-labels";
import { prisma } from "@/lib/prisma";
import { formatDayLabelTr } from "@/lib/plan-dates";
import type { HelpRequestStatus, HelpType, Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

type HelpNotifyKind =
  | "HELP_REQUEST_CREATED"
  | "HELP_OFFER_CREATED"
  | "HELP_OFFER_ACCEPTED"
  | "HELP_REQUEST_CANCELLED"
  | "HELP_SESSION_COMPLETED"
  | "HELP_OFFER_UPDATED"
  | "HELP_OFFER_WITHDRAWN"
  | "HELP_ACCEPTED_CANCELLED"
  | "HELP_REQUEST_REOPENED";

async function activeGuardianUserIds(childId: string, db: Db) {
  const guardians = await db.childGuardianAccess.findMany({
    where: { childId, revokedAt: null },
    select: { userId: true },
  });
  return guardians.map((g) => g.userId);
}

async function createOne(input: {
  recipientUserId: string;
  kind: HelpNotifyKind;
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

export async function notifyGuardiansOfHelpRequest(input: {
  requestId: string;
  childId: string;
  childDisplayName: string;
  planTitle: string;
  helpType: HelpType;
}) {
  const name = input.childDisplayName.trim() || "Çocuğun";
  const typeLabel = helpTypeLabel(input.helpType);
  const recipients = await activeGuardianUserIds(input.childId, prisma);
  for (const userId of recipients) {
    await createOne({
      recipientUserId: userId,
      kind: "HELP_REQUEST_CREATED",
      uniquenessKey: `help_request:${input.requestId}:${userId}`,
      title: `${name} yardım istedi`,
      body: `${input.planTitle} · ${typeLabel}`,
      href: `/veli/yardim/${input.requestId}`,
      childId: input.childId,
    });
  }
}

export async function notifyChildOfHelpOffer(input: {
  requestId: string;
  childUserId: string;
  childId: string;
  guardianName: string;
  planTitle: string;
  proposedDate: string;
  proposedTimeLocal: string;
  offerId: string;
}) {
  const who = input.guardianName.trim() || "Velin";
  const when = `${formatDayLabelTr(input.proposedDate)} ${input.proposedTimeLocal}`;
  await createOne({
    recipientUserId: input.childUserId,
    kind: "HELP_OFFER_CREATED",
    uniquenessKey: `help_offer:${input.offerId}`,
    title: `${who} yardım teklif etti`,
    body: `${input.planTitle} · ${when}`,
    href: `/cocuk/yardim/${input.requestId}`,
    childId: input.childId,
  });
}

export async function notifyChildOfHelpOfferUpdated(input: {
  requestId: string;
  childUserId: string;
  childId: string;
  guardianName: string;
  planTitle: string;
  proposedDate: string;
  proposedTimeLocal: string;
  offerId: string;
}) {
  const who = input.guardianName.trim() || "Velin";
  const when = `${formatDayLabelTr(input.proposedDate)} ${input.proposedTimeLocal}`;
  await createOne({
    recipientUserId: input.childUserId,
    kind: "HELP_OFFER_UPDATED",
    uniquenessKey: `help_offer_updated:${input.offerId}:${input.proposedDate}:${input.proposedTimeLocal}`,
    title: `${who} yardım teklifini güncelledi`,
    body: `${input.planTitle} · ${when}`,
    href: `/cocuk/yardim/${input.requestId}`,
    childId: input.childId,
  });
}

export async function notifyChildOfHelpOfferWithdrawn(input: {
  requestId: string;
  childUserId: string;
  childId: string;
  guardianName: string;
  planTitle: string;
  offerId: string;
}) {
  const who = input.guardianName.trim() || "Velin";
  await createOne({
    recipientUserId: input.childUserId,
    kind: "HELP_OFFER_WITHDRAWN",
    uniquenessKey: `help_offer_withdrawn:${input.offerId}`,
    title: `${who} teklifini geri aldı`,
    body: input.planTitle,
    href: `/cocuk/yardim/${input.requestId}`,
    childId: input.childId,
  });
}

export async function notifyHelpOfferAccepted(input: {
  requestId: string;
  childId: string;
  childDisplayName: string;
  planTitle: string;
  guardianUserId: string;
  proposedDate: string;
  proposedTimeLocal: string;
  db?: Db;
}) {
  const name = input.childDisplayName.trim() || "Çocuğun";
  const when = `${formatDayLabelTr(input.proposedDate)} ${input.proposedTimeLocal}`;
  await createOne({
    recipientUserId: input.guardianUserId,
    kind: "HELP_OFFER_ACCEPTED",
    uniquenessKey: `help_accepted:${input.requestId}:${input.guardianUserId}:${input.proposedDate}:${input.proposedTimeLocal}`,
    title: `${name} yardım teklifini kabul etti`,
    body: `${input.planTitle} · ${when}`,
    href: `/veli/yardim/${input.requestId}`,
    childId: input.childId,
    db: input.db,
  });
}

export async function notifyAcceptedHelpCancelledByGuardian(input: {
  requestId: string;
  childUserId: string;
  childId: string;
  guardianName: string;
  planTitle: string;
  reopenedAs: HelpRequestStatus;
  acceptedOfferId: string;
  db?: Db;
}) {
  const who = input.guardianName.trim() || "Velin";
  const body =
    input.reopenedAs === "OFFERED"
      ? `${input.planTitle} · Başka teklifleri inceleyebilirsin`
      : `${input.planTitle} · Yeni teklif bekleyebilirsin`;
  await createOne({
    recipientUserId: input.childUserId,
    kind: "HELP_ACCEPTED_CANCELLED",
    uniquenessKey: `help_accepted_cancelled:${input.requestId}:${input.acceptedOfferId}`,
    title: `${who} bu yardıma gelemeyeceğini bildirdi`,
    body,
    href: `/cocuk/yardim/${input.requestId}`,
    childId: input.childId,
    db: input.db,
  });
}

export async function notifyHelpReopenedDueToPlanChange(input: {
  requestId: string;
  childUserId: string;
  childId: string;
  planTitle: string;
  guardianUserIds: string[];
  acceptedOfferId: string;
  db?: Db;
}) {
  await createOne({
    recipientUserId: input.childUserId,
    kind: "HELP_REQUEST_REOPENED",
    uniquenessKey: `help_reopened_plan:${input.requestId}:${input.acceptedOfferId}:child`,
    title: "Yardım planı güncellendi",
    body: `${input.planTitle} · Plan değiştiği için yardım yeniden ayarlanmalı`,
    href: `/cocuk/yardim/${input.requestId}`,
    childId: input.childId,
    db: input.db,
  });
  for (const userId of input.guardianUserIds) {
    await createOne({
      recipientUserId: userId,
      kind: "HELP_REQUEST_REOPENED",
      uniquenessKey: `help_reopened_plan:${input.requestId}:${input.acceptedOfferId}:${userId}`,
      title: "Yardım planı güncellendi",
      body: `${input.planTitle} · Plan değiştiği için kabul edilen yardım açıldı`,
      href: `/veli/yardim/${input.requestId}`,
      childId: input.childId,
      db: input.db,
    });
  }
}

export async function notifyHelpRequestCancelled(input: {
  requestId: string;
  childId: string;
  childDisplayName: string;
  planTitle: string;
  previousStatus: string;
  acceptedGuardianUserId: string | null;
  offerGuardianIds: string[];
}) {
  const name = input.childDisplayName.trim() || "Çocuğun";
  const targets = new Set<string>();
  if (input.acceptedGuardianUserId) targets.add(input.acceptedGuardianUserId);
  for (const id of input.offerGuardianIds) targets.add(id);
  if (targets.size === 0) {
    const all = await activeGuardianUserIds(input.childId, prisma);
    for (const id of all) targets.add(id);
  }
  for (const userId of targets) {
    await createOne({
      recipientUserId: userId,
      kind: "HELP_REQUEST_CANCELLED",
      uniquenessKey: `help_cancelled:${input.requestId}:${userId}`,
      title: `${name} yardım isteğini iptal etti`,
      body: input.planTitle,
      href: `/veli/yardim`,
      childId: input.childId,
    });
  }
}

export async function notifyHelpSessionCompleted(input: {
  requestId: string;
  childId: string;
  childDisplayName: string;
  planTitle: string;
  guardianUserId: string;
}) {
  const name = input.childDisplayName.trim() || "Çocuğun";
  await createOne({
    recipientUserId: input.guardianUserId,
    kind: "HELP_SESSION_COMPLETED",
    uniquenessKey: `help_completed:${input.requestId}:${input.guardianUserId}`,
    title: `${name} yardımı tamamladı`,
    body: input.planTitle,
    href: `/veli/yardim/${input.requestId}`,
    childId: input.childId,
  });
}
