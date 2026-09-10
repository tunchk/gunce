import type { JournalPrompt, Prisma } from "@prisma/client";
import { PROMPT_OPTIONS } from "@/lib/constants";
import {
  excerptSharedText,
  formatDiaryDate,
  type ParentSharedItem,
} from "@/lib/journal-view";
import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/lib/session";

export { PROMPT_OPTIONS, excerptSharedText, formatDiaryDate };
export type { ParentSharedItem };

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

const entryInclude = {
  draft: true,
  published: true,
  suggestions: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.JournalEntryInclude;

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
    include: entryInclude,
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
  originalBody: string;
  acceptedSummary: string;
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
  latestSuggestion: null | {
    id: string;
    requestId: string;
    suggestedText: string;
    sourceRevision: number;
    status: "PENDING" | "ACCEPTED" | "DISCARDED" | "STALE";
    isStale: boolean;
    createdAt: string;
  };
};

function toChildEntryView(entry: {
  id: string;
  promptKey: JournalPrompt | null;
  diaryDate: Date;
  body: string;
  originalBody: string;
  acceptedSummary: string;
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
  suggestions?: Array<{
    id: string;
    requestId: string;
    suggestedText: string;
    sourceRevision: number;
    status: "PENDING" | "ACCEPTED" | "DISCARDED" | "STALE";
    createdAt: Date;
  }>;
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

  const latest = entry.suggestions?.[0] ?? null;
  const isStale = Boolean(
    latest &&
      (latest.status === "STALE" ||
        (latest.status === "PENDING" && latest.sourceRevision !== entry.revision)),
  );

  return {
    id: entry.id,
    promptKey: entry.promptKey,
    diaryDate: entry.diaryDate.toISOString().slice(0, 10),
    body: entry.body,
    originalBody: entry.originalBody,
    acceptedSummary: entry.acceptedSummary,
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
    latestSuggestion: latest
      ? {
          id: latest.id,
          requestId: latest.requestId,
          suggestedText: latest.suggestedText,
          sourceRevision: latest.sourceRevision,
          status: isStale && latest.status === "PENDING" ? "STALE" : latest.status,
          isStale,
          createdAt: latest.createdAt.toISOString(),
        }
      : null,
  };
}

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
      originalBody: body,
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

  const originalBody =
    !entry.originalBody.trim() && body.trim() ? body : entry.originalBody;

  const updated = await prisma.journalEntry.updateMany({
    where: {
      id: entry.id,
      revision: input.expectedRevision,
    },
    data: {
      body,
      originalBody,
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

  // Mark pending suggestions as stale when the source text changes.
  await prisma.journalSuggestion.updateMany({
    where: {
      entryId: entry.id,
      status: "PENDING",
    },
    data: { status: "STALE" },
  });

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
      // Republish changes the snapshot; drop cached parent guidance.
      await tx.parentGuidance.deleteMany({ where: { shareId: existing.id } });
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

  await prisma.$transaction(async (tx) => {
    await tx.parentGuidance.deleteMany({ where: { shareId: entry.published!.id } });
    await tx.publishedShare.update({
      where: { id: entry.published!.id },
      data: { withdrawnAt: new Date() },
    });
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

export async function saveTranscriptSegment(input: {
  childUserId: string;
  entryId: string;
  segmentId: string;
  sessionId: string;
  sequence: number;
  transcriptText: string;
}) {
  const text = normalizeOptionalText(input.transcriptText, JOURNAL_BODY_MAX);
  if (!text.trim()) {
    throw new JournalError("Çözümlenen metin boş.", "VALIDATION");
  }
  if (!input.segmentId.trim() || input.segmentId.length > 80) {
    throw new JournalError("segmentId geçersiz.", "VALIDATION");
  }
  if (!input.sessionId.trim() || input.sessionId.length > 80) {
    throw new JournalError("sessionId geçersiz.", "VALIDATION");
  }
  if (!Number.isInteger(input.sequence) || input.sequence < 1 || input.sequence > 100) {
    throw new JournalError("sequence geçersiz.", "VALIDATION");
  }

  const { entry } = await requireOwnedEntry(input.childUserId, input.entryId);

  const existing = await prisma.journalTranscript.findUnique({
    where: { segmentId: input.segmentId },
  });
  if (existing) {
    if (existing.entryId !== entry.id) {
      throw new JournalError("Bu bölüm başka bir kayda ait.", "CONFLICT");
    }
    // Idempotent retry: do not duplicate or overwrite with empty; keep first text.
    return {
      id: existing.id,
      segmentId: existing.segmentId!,
      sequence: existing.sequence,
      sessionId: existing.sessionId,
      text: existing.text,
      duplicated: true as const,
    };
  }

  // Entry may have been deleted between auth check and write.
  const still = await prisma.journalEntry.findFirst({
    where: { id: entry.id, childId: entry.childId },
    select: { id: true },
  });
  if (!still) {
    throw new JournalError("Kayıt silindi.", "GONE");
  }

  const created = await prisma.journalTranscript.create({
    data: {
      entryId: entry.id,
      text,
      segmentId: input.segmentId,
      sequence: input.sequence,
      sessionId: input.sessionId,
      sourceRevision: 0,
    },
  });

  return {
    id: created.id,
    segmentId: created.segmentId!,
    sequence: created.sequence,
    sessionId: created.sessionId,
    text: created.text,
    duplicated: false as const,
  };
}

export async function listTranscriptSegments(childUserId: string, entryId: string) {
  const { entry } = await requireOwnedEntry(childUserId, entryId);
  const rows = await prisma.journalTranscript.findMany({
    where: {
      entryId: entry.id,
      segmentId: { not: null },
    },
    orderBy: [{ sessionId: "asc" }, { sequence: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      segmentId: true,
      sequence: true,
      sessionId: true,
      text: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    segmentId: r.segmentId!,
    sequence: r.sequence,
    sessionId: r.sessionId,
    text: r.text,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function applyTranscriptToEntry(input: {
  childUserId: string;
  entryId: string;
  transcriptText: string;
  expectedRevision: number;
  mode: "append" | "replace";
  /** When assembling already-persisted segments into the body, skip an extra row. */
  skipTranscriptRow?: boolean;
}) {
  const text = normalizeOptionalText(input.transcriptText, JOURNAL_BODY_MAX);
  if (!text.trim()) {
    throw new JournalError("Çözümlenen metin boş.", "VALIDATION");
  }

  const { entry } = await requireOwnedEntry(input.childUserId, input.entryId);
  if (entry.revision !== input.expectedRevision) {
    throw new JournalError(
      "Bu kayıt başka bir yerde güncellendi. Sayfayı yenileyip tekrar dene.",
      "CONFLICT",
    );
  }

  const nextBody =
    input.mode === "replace" || !entry.body.trim()
      ? text
      : `${entry.body.trim()}\n\n${text}`.slice(0, JOURNAL_BODY_MAX);

  const originalBody =
    !entry.originalBody.trim() ? nextBody : entry.originalBody;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.journalEntry.updateMany({
      where: { id: entry.id, revision: input.expectedRevision },
      data: {
        body: nextBody,
        originalBody,
        revision: { increment: 1 },
        status: "SAVED",
      },
    });
    if (updated.count !== 1) {
      throw new JournalError(
        "Bu kayıt başka bir yerde güncellendi. Sayfayı yenileyip tekrar dene.",
        "CONFLICT",
      );
    }

    if (!input.skipTranscriptRow) {
      await tx.journalTranscript.create({
        data: {
          entryId: entry.id,
          text,
          sourceRevision: input.expectedRevision + 1,
          sequence: 1,
        },
      });
    }

    await tx.journalSuggestion.updateMany({
      where: { entryId: entry.id, status: "PENDING" },
      data: { status: "STALE" },
    });
  });

  const fresh = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: entryInclude,
  });
  return toChildEntryView(fresh);
}

export async function createSummarySuggestion(input: {
  childUserId: string;
  entryId: string;
  requestId: string;
  expectedRevision: number;
  suggestedText: string;
}) {
  const { entry } = await requireOwnedEntry(input.childUserId, input.entryId);

  // Entry still exists; discard if revision no longer matches (caller should check too).
  if (entry.revision !== input.expectedRevision) {
    throw new JournalError(
      "Metin değiştiği için bu öneri artık geçerli değil.",
      "CONFLICT",
    );
  }

  const suggestedText = normalizeOptionalText(input.suggestedText, JOURNAL_BODY_MAX);
  if (!suggestedText.trim()) {
    throw new JournalError("Özet önerisi boş.", "VALIDATION");
  }

  // Idempotent on requestId
  const existing = await prisma.journalSuggestion.findUnique({
    where: { requestId: input.requestId },
  });
  if (existing) {
    if (existing.entryId !== entry.id) {
      throw new JournalError("Bu istek başka bir kayda ait.", "CONFLICT");
    }
    const fresh = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: entryInclude,
    });
    return toChildEntryView(fresh);
  }

  // Re-check entry exists right before write (guards mid-flight delete).
  const stillThere = await prisma.journalEntry.findFirst({
    where: { id: entry.id, childId: entry.childId },
    select: { id: true, revision: true },
  });
  if (!stillThere) {
    throw new JournalError("Kayıt silindi.", "GONE");
  }
  if (stillThere.revision !== input.expectedRevision) {
    throw new JournalError(
      "Metin değiştiği için bu öneri artık geçerli değil.",
      "CONFLICT",
    );
  }

  await prisma.journalSuggestion.create({
    data: {
      entryId: entry.id,
      requestId: input.requestId,
      suggestedText,
      sourceRevision: input.expectedRevision,
      status: "PENDING",
    },
  });

  const fresh = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: entryInclude,
  });
  return toChildEntryView(fresh);
}

export async function acceptSummarySuggestion(input: {
  childUserId: string;
  entryId: string;
  suggestionId: string;
  expectedRevision: number;
  editedText?: string;
}) {
  const { entry } = await requireOwnedEntry(input.childUserId, input.entryId);
  if (entry.revision !== input.expectedRevision) {
    throw new JournalError(
      "Bu kayıt başka bir yerde güncellendi. Sayfayı yenileyip tekrar dene.",
      "CONFLICT",
    );
  }

  const suggestion = await prisma.journalSuggestion.findFirst({
    where: { id: input.suggestionId, entryId: entry.id },
  });
  if (!suggestion) {
    throw new JournalError("Öneri bulunamadı.", "NOT_FOUND");
  }
  if (suggestion.status === "STALE" || suggestion.sourceRevision !== entry.revision) {
    throw new JournalError(
      "Bu öneri güncel metne ait değil. Yeniden öneri iste.",
      "CONFLICT",
    );
  }

  const accepted = normalizeOptionalText(
    input.editedText ?? suggestion.suggestedText,
    JOURNAL_BODY_MAX,
  );
  if (!accepted.trim()) {
    throw new JournalError("Kabul edilecek özet boş olamaz.", "VALIDATION");
  }

  const originalBody = entry.acceptedSummary.trim()
    ? entry.originalBody.trim() || entry.body
    : entry.body;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.journalEntry.updateMany({
      where: { id: entry.id, revision: input.expectedRevision },
      data: {
        body: accepted,
        originalBody,
        acceptedSummary: accepted,
        revision: { increment: 1 },
        status: "SAVED",
      },
    });
    if (updated.count !== 1) {
      throw new JournalError(
        "Bu kayıt başka bir yerde güncellendi. Sayfayı yenileyip tekrar dene.",
        "CONFLICT",
      );
    }
    await tx.journalSuggestion.update({
      where: { id: suggestion.id },
      data: { status: "ACCEPTED", suggestedText: accepted },
    });
    await tx.journalSuggestion.updateMany({
      where: {
        entryId: entry.id,
        status: "PENDING",
        id: { not: suggestion.id },
      },
      data: { status: "STALE" },
    });
  });

  const fresh = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: entryInclude,
  });
  return toChildEntryView(fresh);
}

export async function discardSummarySuggestion(input: {
  childUserId: string;
  entryId: string;
  suggestionId: string;
}) {
  const { entry } = await requireOwnedEntry(input.childUserId, input.entryId);
  const suggestion = await prisma.journalSuggestion.findFirst({
    where: { id: input.suggestionId, entryId: entry.id },
  });
  if (!suggestion) {
    throw new JournalError("Öneri bulunamadı.", "NOT_FOUND");
  }

  await prisma.journalSuggestion.update({
    where: { id: suggestion.id },
    data: { status: "DISCARDED" },
  });

  const fresh = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: entryInclude,
  });
  return toChildEntryView(fresh);
}

export type ParentShareDetail = {
  shareId: string;
  entryId: string;
  childId: string;
  childDisplayName: string;
  diaryDate: string;
  publishedAt: string;
  parentMessage: string;
  supportRequest: string;
  snapshotRevision: number;
};

export type ParentGuidanceView = {
  shareId: string;
  snapshotRevision: number;
  conversationOpener: string;
  supportAction: string;
  label: "AI önerisi · Paylaşılanlara dayanır";
  available: true;
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
      guidance: true,
    },
    orderBy: { publishedAt: "desc" },
  });

  const items: ParentSharedItem[] = shares.map((share) => {
    const hasMessage = Boolean(share.parentMessage.trim());
    const hasSupport = Boolean(share.supportRequest.trim());
    const guidanceFresh =
      share.guidance &&
      share.guidance.snapshotRevision === share.sourceDraftRevision
        ? share.guidance
        : null;
    return {
      shareId: share.id,
      entryId: share.entryId,
      childId: share.childId,
      childDisplayName: share.child.displayName,
      diaryDate: share.entry.diaryDate.toISOString().slice(0, 10),
      publishedAt: share.publishedAt.toISOString(),
      parentMessage: share.parentMessage,
      supportRequest: share.supportRequest,
      snapshotRevision: share.sourceDraftRevision,
      kind: hasMessage && hasSupport ? "both" : hasSupport ? "support" : "message",
      guidanceOpener: guidanceFresh?.conversationOpener ?? null,
    };
  });

  return {
    messages: items.filter((i) => i.parentMessage.trim()),
    supportRequests: items.filter((i) => i.supportRequest.trim()),
  };
}

/** Parent detail by share id — authorized published snapshot only. */
export async function getParentShareDetail(
  parentUserId: string,
  shareId: string,
): Promise<ParentShareDetail> {
  const membership = await prisma.familyMembership.findUnique({
    where: { userId: parentUserId },
  });
  if (!membership) {
    throw new JournalError("Aile bulunamadı.", "NOT_FOUND");
  }

  const share = await prisma.publishedShare.findUnique({
    where: { id: shareId },
    include: {
      child: { select: { id: true, displayName: true, familyId: true } },
      entry: { select: { diaryDate: true } },
    },
  });

  if (!share || share.familyId !== membership.familyId || share.withdrawnAt) {
    throw new JournalError("Bu içerik seninle paylaşılmamış.", "NOT_FOUND");
  }

  return {
    shareId: share.id,
    entryId: share.entryId,
    childId: share.childId,
    childDisplayName: share.child.displayName,
    diaryDate: share.entry.diaryDate.toISOString().slice(0, 10),
    publishedAt: share.publishedAt.toISOString(),
    parentMessage: share.parentMessage,
    supportRequest: share.supportRequest,
    snapshotRevision: share.sourceDraftRevision,
  };
}

/**
 * Cached or freshly generated parent guidance.
 * Uses only published parentMessage / supportRequest.
 * Re-checks authorization and snapshot revision before storing an in-flight result.
 */
export async function getOrCreateParentGuidance(input: {
  parentUserId: string;
  shareId: string;
  generate: (args: {
    parentMessage: string;
    supportRequest: string;
  }) => Promise<{ conversationOpener: string; supportAction: string; provider: string }>;
}): Promise<ParentGuidanceView | { available: false; reason: string }> {
  const detail = await getParentShareDetail(input.parentUserId, input.shareId);

  const existing = await prisma.parentGuidance.findUnique({
    where: { shareId: input.shareId },
  });
  if (existing && existing.snapshotRevision === detail.snapshotRevision) {
    return {
      shareId: input.shareId,
      snapshotRevision: existing.snapshotRevision,
      conversationOpener: existing.conversationOpener,
      supportAction: existing.supportAction,
      label: "AI önerisi · Paylaşılanlara dayanır",
      available: true,
    };
  }

  if (existing) {
    await prisma.parentGuidance.delete({ where: { id: existing.id } });
  }

  const result = await input.generate({
    parentMessage: detail.parentMessage,
    supportRequest: detail.supportRequest,
  });

  // Mid-flight: share may have been withdrawn, deleted, or republished.
  const still = await prisma.publishedShare.findUnique({
    where: { id: input.shareId },
    select: {
      id: true,
      familyId: true,
      withdrawnAt: true,
      sourceDraftRevision: true,
      parentMessage: true,
      supportRequest: true,
    },
  });
  const membership = await prisma.familyMembership.findUnique({
    where: { userId: input.parentUserId },
  });
  if (
    !still ||
    !membership ||
    still.familyId !== membership.familyId ||
    still.withdrawnAt ||
    still.sourceDraftRevision !== detail.snapshotRevision
  ) {
    throw new JournalError("Bu içerik artık seninle paylaşılmıyor.", "GONE");
  }

  // Never persist if published fields somehow diverged to include private leakage —
  // store only what we authorized at generate time (still's published fields).
  const saved = await prisma.parentGuidance.upsert({
    where: { shareId: input.shareId },
    create: {
      shareId: input.shareId,
      snapshotRevision: still.sourceDraftRevision,
      conversationOpener: result.conversationOpener.slice(0, 400),
      supportAction: result.supportAction.slice(0, 400),
      provider: result.provider.slice(0, 80),
    },
    update: {
      snapshotRevision: still.sourceDraftRevision,
      conversationOpener: result.conversationOpener.slice(0, 400),
      supportAction: result.supportAction.slice(0, 400),
      provider: result.provider.slice(0, 80),
    },
  });

  return {
    shareId: input.shareId,
    snapshotRevision: saved.snapshotRevision,
    conversationOpener: saved.conversationOpener,
    supportAction: saved.supportAction,
    label: "AI önerisi · Paylaşılanlara dayanır",
    available: true,
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
    shareId: entry.published.id,
    entryId: entry.id,
    childId: entry.childId,
    childDisplayName: entry.child.displayName,
    diaryDate: entry.diaryDate.toISOString().slice(0, 10),
    parentMessage: entry.published.parentMessage,
    supportRequest: entry.published.supportRequest,
    publishedAt: entry.published.publishedAt.toISOString(),
    snapshotRevision: entry.published.sourceDraftRevision,
    // Explicitly omit body / transcripts / suggestions
  };
}
