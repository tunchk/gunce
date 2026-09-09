import type { JournalPrompt, Prisma } from "@prisma/client";
import { PROMPT_OPTIONS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/lib/session";

export { PROMPT_OPTIONS };

export const JOURNAL_BODY_MAX = 8000;
export const SHARE_FIELD_MAX = 4000;

export class JournalError extends Error {
  constructor(
    message: string,
    public code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "VALIDATION"
      | "EMPTY_SHARE"
      | "UNAUTHORIZED"
      | "GONE",
  ) {
    super(message);
    this.name = "JournalError";
  }
}

export function diaryDateForTimeZone(timeZone: string, at = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) {
    throw new JournalError("Saat dilimi tarihi hesaplanamadı.", "VALIDATION");
  }
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

export function formatDiaryDate(date: Date, _timeZone?: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

async function requireChildProfile(childUserId: string) {
  const child = await prisma.childProfile.findUnique({
    where: { userId: childUserId },
  });
  if (!child) {
    throw new AuthorizationError("Çocuk profili bulunamadı.");
  }
  return child;
}

async function requireOwnedEntry(childUserId: string, entryId: string) {
  const child = await requireChildProfile(childUserId);
  const entry = await prisma.journalEntry.findFirst({
    where: { id: entryId, childId: child.id },
    include: {
      draft: true,
      published: true,
    },
  });
  if (!entry) {
    throw new JournalError("Kayıt bulunamadı.", "NOT_FOUND");
  }
  return { child, entry };
}

function clampText(value: string, max: number): string {
  return value.slice(0, max);
}

function normalizeOptionalText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return clampText(value.trimEnd().slice(0, max), max);
}

export type ChildEntryView = {
  id: string;
  promptKey: JournalPrompt | null;
  diaryDate: string;
  body: string;
  status: "DRAFT" | "SAVED";
  revision: number;
  updatedAt: string;
  draft: {
    parentMessage: string;
    supportRequest: string;
    revision: number;
  };
  published: null | {
    parentMessage: string;
    supportRequest: string;
    publishedAt: string;
    sourceDraftRevision: number;
    hasUnpublishedChanges: boolean;
  };
};

function toChildEntryView(entry: {
  id: string;
  promptKey: JournalPrompt | null;
  diaryDate: Date;
  body: string;
  status: "DRAFT" | "SAVED";
  revision: number;
  updatedAt: Date;
  draft: { parentMessage: string; supportRequest: string; revision: number } | null;
  published: {
    parentMessage: string;
    supportRequest: string;
    publishedAt: Date;
    withdrawnAt: Date | null;
    sourceDraftRevision: number;
  } | null;
}): ChildEntryView {
  const draft = entry.draft ?? {
    parentMessage: "",
    supportRequest: "",
    revision: 1,
  };
  const activePublished =
    entry.published && !entry.published.withdrawnAt ? entry.published : null;

  const hasUnpublishedChanges = Boolean(
    activePublished &&
      (draft.parentMessage !== activePublished.parentMessage ||
        draft.supportRequest !== activePublished.supportRequest ||
        draft.revision !== activePublished.sourceDraftRevision),
  );

  return {
    id: entry.id,
    promptKey: entry.promptKey,
    diaryDate: entry.diaryDate.toISOString().slice(0, 10),
    body: entry.body,
    status: entry.status,
    revision: entry.revision,
    updatedAt: entry.updatedAt.toISOString(),
    draft: {
      parentMessage: draft.parentMessage,
      supportRequest: draft.supportRequest,
      revision: draft.revision,
    },
    published: activePublished
      ? {
          parentMessage: activePublished.parentMessage,
          supportRequest: activePublished.supportRequest,
          publishedAt: activePublished.publishedAt.toISOString(),
          sourceDraftRevision: activePublished.sourceDraftRevision,
          hasUnpublishedChanges,
        }
      : null,
  };
}

const entryInclude = {
  draft: true,
  published: true,
} satisfies Prisma.JournalEntryInclude;

export async function listChildEntries(childUserId: string) {
  const child = await requireChildProfile(childUserId);
  const entries = await prisma.journalEntry.findMany({
    where: { childId: child.id },
    include: entryInclude,
    orderBy: [{ diaryDate: "desc" }, { updatedAt: "desc" }],
  });
  return entries.map(toChildEntryView);
}

export async function getChildEntry(childUserId: string, entryId: string) {
  const { entry } = await requireOwnedEntry(childUserId, entryId);
  return toChildEntryView(entry);
}

export async function createJournalEntry(input: {
  childUserId: string;
  promptKey?: JournalPrompt | null;
  body?: string;
  clientRequestId?: string | null;
}) {
  const child = await requireChildProfile(input.childUserId);
  const clientRequestId = input.clientRequestId?.trim() || null;

  if (clientRequestId) {
    const existing = await prisma.journalEntry.findUnique({
      where: { clientRequestId },
      include: entryInclude,
    });
    if (existing) {
      if (existing.childId !== child.id) {
        throw new JournalError("Bu istek başka bir kayda ait.", "CONFLICT");
      }
      return toChildEntryView(existing);
    }
  }

  const body = normalizeOptionalText(input.body ?? "", JOURNAL_BODY_MAX);
  const entry = await prisma.journalEntry.create({
    data: {
      childId: child.id,
      promptKey: input.promptKey ?? null,
      diaryDate: diaryDateForTimeZone(child.timeZone),
      body,
      status: body.trim() ? "SAVED" : "DRAFT",
      clientRequestId,
      draft: {
        create: {
          parentMessage: "",
          supportRequest: "",
        },
      },
    },
    include: entryInclude,
  });

  return toChildEntryView(entry);
}

export async function updateJournalBody(input: {
  childUserId: string;
  entryId: string;
  body: string;
  expectedRevision: number;
  markSaved?: boolean;
}) {
  const { entry } = await requireOwnedEntry(input.childUserId, input.entryId);
  const body = normalizeOptionalText(input.body, JOURNAL_BODY_MAX);

  if (entry.revision !== input.expectedRevision) {
    throw new JournalError(
      "Bu kayıt başka bir yerde güncellendi. Sayfayı yenileyip tekrar dene.",
      "CONFLICT",
    );
  }

  const updated = await prisma.journalEntry.updateMany({
    where: {
      id: entry.id,
      revision: input.expectedRevision,
    },
    data: {
      body,
      revision: { increment: 1 },
      status: input.markSaved || body.trim() ? "SAVED" : "DRAFT",
    },
  });

  if (updated.count !== 1) {
    throw new JournalError(
      "Bu kayıt başka bir yerde güncellendi. Sayfayı yenileyip tekrar dene.",
      "CONFLICT",
    );
  }

  const fresh = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: entryInclude,
  });
  return toChildEntryView(fresh);
}

export async function updateSharingDraft(input: {
  childUserId: string;
  entryId: string;
  parentMessage?: string;
  supportRequest?: string;
  expectedRevision: number;
}) {
  const { entry } = await requireOwnedEntry(input.childUserId, input.entryId);
  let draft = entry.draft;
  if (!draft) {
    draft = await prisma.sharingDraft.create({
      data: {
        entryId: entry.id,
        parentMessage: "",
        supportRequest: "",
      },
    });
  }

  if (draft.revision !== input.expectedRevision) {
    throw new JournalError(
      "Paylaşım taslağı başka bir yerde güncellendi. Yenileyip tekrar dene.",
      "CONFLICT",
    );
  }

  const parentMessage =
    input.parentMessage !== undefined
      ? normalizeOptionalText(input.parentMessage, SHARE_FIELD_MAX)
      : draft.parentMessage;
  const supportRequest =
    input.supportRequest !== undefined
      ? normalizeOptionalText(input.supportRequest, SHARE_FIELD_MAX)
      : draft.supportRequest;

  const updated = await prisma.sharingDraft.updateMany({
    where: { id: draft.id, revision: input.expectedRevision },
    data: {
      parentMessage,
      supportRequest,
      revision: { increment: 1 },
    },
  });

  if (updated.count !== 1) {
    throw new JournalError(
      "Paylaşım taslağı başka bir yerde güncellendi. Yenileyip tekrar dene.",
      "CONFLICT",
    );
  }

  const fresh = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: entryInclude,
  });
  return toChildEntryView(fresh);
}

export async function publishShare(input: {
  childUserId: string;
  entryId: string;
  expectedDraftRevision: number;
}) {
  const { child, entry } = await requireOwnedEntry(input.childUserId, input.entryId);
  let draft = entry.draft;
  if (!draft) {
    draft = await prisma.sharingDraft.create({
      data: { entryId: entry.id },
    });
  }

  if (draft.revision !== input.expectedDraftRevision) {
    throw new JournalError(
      "Paylaşım taslağı değişmiş. Önizlemeyi yenileyip tekrar dene.",
      "CONFLICT",
    );
  }

  const parentMessage = draft.parentMessage.trim();
  const supportRequest = draft.supportRequest.trim();
  if (!parentMessage && !supportRequest) {
    throw new JournalError(
      "Paylaşmak için bir veli mesajı veya destek isteği yazmalısın.",
      "EMPTY_SHARE",
    );
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.publishedShare.findUnique({
      where: { entryId: entry.id },
    });

    if (existing) {
      await tx.publishedShare.update({
        where: { id: existing.id },
        data: {
          parentMessage,
          supportRequest,
          sourceDraftRevision: draft!.revision,
          publishedAt: new Date(),
          withdrawnAt: null,
          childId: child.id,
          familyId: child.familyId,
        },
      });
    } else {
      await tx.publishedShare.create({
        data: {
          entryId: entry.id,
          childId: child.id,
          familyId: child.familyId,
          parentMessage,
          supportRequest,
          sourceDraftRevision: draft!.revision,
        },
      });
    }

    if (entry.status === "DRAFT") {
      await tx.journalEntry.update({
        where: { id: entry.id },
        data: { status: "SAVED" },
      });
    }
  });

  const fresh = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: entryInclude,
  });
  return toChildEntryView(fresh);
}

export async function withdrawShare(input: {
  childUserId: string;
  entryId: string;
}) {
  const { entry } = await requireOwnedEntry(input.childUserId, input.entryId);
  if (!entry.published || entry.published.withdrawnAt) {
    throw new JournalError("Aktif bir paylaşım yok.", "GONE");
  }

  await prisma.publishedShare.update({
    where: { id: entry.published.id },
    data: { withdrawnAt: new Date() },
  });

  const fresh = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: entryInclude,
  });
  return toChildEntryView(fresh);
}

export async function deleteJournalEntry(input: {
  childUserId: string;
  entryId: string;
}) {
  const { entry } = await requireOwnedEntry(input.childUserId, input.entryId);
  await prisma.journalEntry.delete({ where: { id: entry.id } });
  return { ok: true as const };
}

export type ParentSharedItem = {
  shareId: string;
  entryId: string;
  childId: string;
  childDisplayName: string;
  diaryDate: string;
  publishedAt: string;
  parentMessage: string;
  supportRequest: string;
  kind: "message" | "support" | "both";
};

export async function listParentSharedContent(parentUserId: string): Promise<{
  messages: ParentSharedItem[];
  supportRequests: ParentSharedItem[];
}> {
  const membership = await prisma.familyMembership.findUnique({
    where: { userId: parentUserId },
  });
  if (!membership) {
    return { messages: [], supportRequests: [] };
  }

  const shares = await prisma.publishedShare.findMany({
    where: {
      familyId: membership.familyId,
      withdrawnAt: null,
    },
    include: {
      child: { select: { id: true, displayName: true } },
      entry: { select: { diaryDate: true } },
    },
    orderBy: { publishedAt: "desc" },
  });

  const items: ParentSharedItem[] = shares.map((share) => {
    const hasMessage = Boolean(share.parentMessage.trim());
    const hasSupport = Boolean(share.supportRequest.trim());
    return {
      shareId: share.id,
      entryId: share.entryId,
      childId: share.childId,
      childDisplayName: share.child.displayName,
      diaryDate: share.entry.diaryDate.toISOString().slice(0, 10),
      publishedAt: share.publishedAt.toISOString(),
      parentMessage: share.parentMessage,
      supportRequest: share.supportRequest,
      kind: hasMessage && hasSupport ? "both" : hasSupport ? "support" : "message",
    };
  });

  return {
    messages: items.filter((i) => i.parentMessage.trim()),
    supportRequests: items.filter((i) => i.supportRequest.trim()),
  };
}

/** Parent probe by entry id — must never return private body. */
export async function parentTryGetEntry(parentUserId: string, entryId: string) {
  const membership = await prisma.familyMembership.findUnique({
    where: { userId: parentUserId },
  });
  if (!membership) {
    throw new JournalError("Aile bulunamadı.", "NOT_FOUND");
  }

  const entry = await prisma.journalEntry.findUnique({
    where: { id: entryId },
    include: {
      child: true,
      published: true,
    },
  });

  if (!entry || entry.child.familyId !== membership.familyId) {
    throw new JournalError("Kayıt bulunamadı.", "NOT_FOUND");
  }

  if (!entry.published || entry.published.withdrawnAt) {
    throw new JournalError("Bu içerik seninle paylaşılmamış.", "NOT_FOUND");
  }

  return {
    entryId: entry.id,
    childId: entry.childId,
    childDisplayName: entry.child.displayName,
    diaryDate: entry.diaryDate.toISOString().slice(0, 10),
    parentMessage: entry.published.parentMessage,
    supportRequest: entry.published.supportRequest,
    publishedAt: entry.published.publishedAt.toISOString(),
    // Explicitly omit body
  };
}
