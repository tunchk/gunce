import type {
  PlanCommitmentType,
  PlanExtractBatchStatus,
  PlanExtractCandidateStatus,
  PlanExtractCandidateType,
  PlanExtractMentionKind,
  Prisma,
} from "@prisma/client";
import type { PlanExtractCandidateDraft } from "@/lib/ai/types";
import {
  commitmentExcerptIsGrounded,
  excerptOccursInSource,
  resolvePlanExtractDate,
  studyStepExcerptIsGrounded,
} from "@/lib/plan-extract-dates";
import { formatCalendarDate, parseCalendarDate } from "@/lib/plan-dates";
import {
  createCommitment,
  createStudyStep,
  PlanError,
} from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/lib/session";

const TITLE_MAX = 200;
const SUBJECT_MAX = 80;
const EXCERPT_MAX = 400;

export class PlanExtractError extends Error {
  constructor(
    message: string,
    public code:
      | "NOT_FOUND"
      | "GONE"
      | "CONFLICT"
      | "VALIDATION"
      | "DUPLICATE_REVIEW"
      | "FORBIDDEN",
    public details?: unknown,
  ) {
    super(message);
    this.name = "PlanExtractError";
  }
}

export type ExtractCandidateView = {
  id: string;
  ordinal: number;
  type: PlanExtractCandidateType;
  mentionKind: PlanExtractMentionKind;
  title: string;
  subject: string;
  sourceExcerpt: string;
  datePhrase: string;
  proposedDate: string | null;
  dateUncertain: boolean;
  /** Exams/courses need a confirmed event date before apply. */
  requiresConfirmedDate: boolean;
  estimatedMinutes: number | null;
  relatedCandidateOrdinal: number | null;
  status: PlanExtractCandidateStatus;
  appliedCommitmentId: string | null;
  appliedStudyStepId: string | null;
  likelyDuplicates: Array<{
    kind: "commitment" | "study_step";
    id: string;
    title: string;
    type?: PlanCommitmentType;
  }>;
};

export type ExtractBatchView = {
  id: string;
  entryId: string;
  requestId: string;
  sourceRevision: number;
  diaryDate: string;
  status: PlanExtractBatchStatus;
  provider: string;
  isStale: boolean;
  candidates: ExtractCandidateView[];
};

function clamp(text: string, max: number) {
  return text.trim().slice(0, max);
}

function normalizeTitleKey(title: string) {
  return title
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefer child-authored narrative over an accepted AI summary. */
export function extractionSourceText(entry: {
  body: string;
  originalBody: string;
  acceptedSummary: string;
}): string {
  if (entry.acceptedSummary.trim() && entry.originalBody.trim()) {
    return entry.originalBody.trim();
  }
  return entry.body.trim();
}

async function requireChildProfile(childUserId: string) {
  const child = await prisma.childProfile.findUnique({
    where: { userId: childUserId },
  });
  if (!child) throw new AuthorizationError("Çocuk profili bulunamadı.");
  return child;
}

async function requireOwnedEntry(childUserId: string, entryId: string) {
  const child = await requireChildProfile(childUserId);
  const entry = await prisma.journalEntry.findFirst({
    where: { id: entryId, childId: child.id },
  });
  if (!entry) throw new PlanExtractError("Günlük kaydı bulunamadı.", "NOT_FOUND");
  return { child, entry };
}

type CandidateRow = {
  id: string;
  ordinal: number;
  type: PlanExtractCandidateType;
  mentionKind: PlanExtractMentionKind;
  title: string;
  subject: string;
  sourceExcerpt: string;
  datePhrase: string;
  proposedDate: Date | null;
  dateUncertain: boolean;
  estimatedMinutes: number | null;
  relatedCandidateOrdinal: number | null;
  status: PlanExtractCandidateStatus;
  appliedCommitmentId: string | null;
  appliedStudyStepId: string | null;
};

type BatchRow = {
  id: string;
  entryId: string;
  requestId: string;
  sourceRevision: number;
  diaryDate: Date;
  status: PlanExtractBatchStatus;
  provider: string;
  candidates: CandidateRow[];
};

async function findLikelyDuplicates(
  childId: string,
  candidates: CandidateRow[],
): Promise<Map<string, ExtractCandidateView["likelyDuplicates"]>> {
  const commitments = await prisma.planCommitment.findMany({
    where: { childId },
    select: { id: true, title: true, type: true },
  });
  const steps = await prisma.planStudyStep.findMany({
    where: { childId },
    select: { id: true, title: true },
  });

  const map = new Map<string, ExtractCandidateView["likelyDuplicates"]>();
  for (const c of candidates) {
    if (c.status !== "PENDING") {
      map.set(c.id, []);
      continue;
    }
    const key = normalizeTitleKey(c.title);
    if (!key) {
      map.set(c.id, []);
      continue;
    }
    const matches: ExtractCandidateView["likelyDuplicates"] = [];
    if (c.type === "STUDY_STEP") {
      for (const s of steps) {
        if (normalizeTitleKey(s.title) === key) {
          matches.push({ kind: "study_step", id: s.id, title: s.title });
        }
      }
    } else {
      for (const row of commitments) {
        if (row.type === c.type && normalizeTitleKey(row.title) === key) {
          matches.push({
            kind: "commitment",
            id: row.id,
            title: row.title,
            type: row.type,
          });
        }
      }
    }
    map.set(c.id, matches);
  }
  return map;
}

async function toBatchView(
  batch: BatchRow,
  entryRevision: number,
  childId: string,
): Promise<ExtractBatchView> {
  const duplicates = await findLikelyDuplicates(childId, batch.candidates);
  const isStale =
    batch.status === "STALE" || batch.sourceRevision !== entryRevision;

  return {
    id: batch.id,
    entryId: batch.entryId,
    requestId: batch.requestId,
    sourceRevision: batch.sourceRevision,
    diaryDate: formatCalendarDate(batch.diaryDate)!,
    status: isStale && batch.status === "READY" ? "STALE" : batch.status,
    provider: batch.provider,
    isStale,
    candidates: batch.candidates
      .slice()
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((c) => ({
        id: c.id,
        ordinal: c.ordinal,
        type: c.type,
        mentionKind: c.mentionKind,
        title: c.title,
        subject: c.subject,
        sourceExcerpt: c.sourceExcerpt,
        datePhrase: c.datePhrase,
        proposedDate: formatCalendarDate(c.proposedDate),
        dateUncertain: c.dateUncertain,
        requiresConfirmedDate: c.type === "EXAM" || c.type === "COURSE",
        estimatedMinutes: c.estimatedMinutes,
        relatedCandidateOrdinal: c.relatedCandidateOrdinal,
        status: c.status,
        appliedCommitmentId: c.appliedCommitmentId,
        appliedStudyStepId: c.appliedStudyStepId,
        likelyDuplicates: duplicates.get(c.id) ?? [],
      })),
  };
}

const batchInclude = {
  candidates: { orderBy: { ordinal: "asc" as const } },
} satisfies Prisma.PlanExtractBatchInclude;

export async function markPlanExtractBatchesStaleForEntry(entryId: string) {
  await prisma.planExtractBatch.updateMany({
    where: { entryId, status: "READY" },
    data: { status: "STALE" },
  });
}

export async function getLatestPlanExtractBatch(input: {
  childUserId: string;
  entryId: string;
}): Promise<ExtractBatchView | null> {
  const { child, entry } = await requireOwnedEntry(input.childUserId, input.entryId);
  const batch = await prisma.planExtractBatch.findFirst({
    where: { entryId: entry.id, childId: child.id },
    orderBy: { createdAt: "desc" },
    include: batchInclude,
  });
  if (!batch) return null;
  return toBatchView(batch, entry.revision, child.id);
}

export async function getPlanExtractBatch(input: {
  childUserId: string;
  batchId: string;
}): Promise<ExtractBatchView> {
  const child = await requireChildProfile(input.childUserId);
  const batch = await prisma.planExtractBatch.findFirst({
    where: { id: input.batchId, childId: child.id },
    include: {
      ...batchInclude,
      entry: { select: { revision: true } },
    },
  });
  if (!batch) throw new PlanExtractError("Öneri bulunamadı.", "NOT_FOUND");
  return toBatchView(batch, batch.entry.revision, child.id);
}

function sanitizeDrafts(
  drafts: PlanExtractCandidateDraft[],
  sourceText: string,
  diaryDate: string,
): Array<{
  ordinal: number;
  type: PlanExtractCandidateType;
  mentionKind: PlanExtractMentionKind;
  title: string;
  subject: string;
  sourceExcerpt: string;
  datePhrase: string;
  proposedDate: Date | null;
  dateUncertain: boolean;
  estimatedMinutes: number | null;
  relatedCandidateOrdinal: number | null;
}> {
  const out: Array<{
    ordinal: number;
    type: PlanExtractCandidateType;
    mentionKind: PlanExtractMentionKind;
    title: string;
    subject: string;
    sourceExcerpt: string;
    datePhrase: string;
    proposedDate: Date | null;
    dateUncertain: boolean;
    estimatedMinutes: number | null;
    relatedCandidateOrdinal: number | null;
  }> = [];

  drafts.slice(0, 12).forEach((draft, index) => {
    const title = clamp(draft.title ?? "", TITLE_MAX);
    const excerpt = clamp(draft.sourceExcerpt ?? "", EXCERPT_MAX);
    if (!title || !excerpt) return;
    if (!excerptOccursInSource(excerpt, sourceText)) return;

    const type = draft.type;
    if (!["HOMEWORK", "EXAM", "COURSE", "STUDY_STEP"].includes(type)) return;
    if (type === "STUDY_STEP" && !studyStepExcerptIsGrounded(excerpt)) return;
    if (
      (type === "HOMEWORK" || type === "EXAM" || type === "COURSE") &&
      !commitmentExcerptIsGrounded(type, excerpt)
    ) {
      return;
    }

    const mentionKind =
      draft.mentionKind === "PREPARATION" ? "PREPARATION" : "EXPLICIT";

    const resolved = resolvePlanExtractDate({
      diaryDate,
      datePhrase: draft.datePhrase,
      aiProposedDate: draft.proposedDate,
      aiUncertain: draft.dateUncertain,
    });

    let estimatedMinutes: number | null = null;
    if (
      typeof draft.estimatedMinutes === "number" &&
      Number.isInteger(draft.estimatedMinutes) &&
      draft.estimatedMinutes >= 1 &&
      draft.estimatedMinutes <= 1440
    ) {
      estimatedMinutes = draft.estimatedMinutes;
    }

    let relatedCandidateOrdinal: number | null = null;
    if (
      type === "STUDY_STEP" &&
      typeof draft.relatedCandidateIndex === "number" &&
      Number.isInteger(draft.relatedCandidateIndex) &&
      draft.relatedCandidateIndex >= 0 &&
      draft.relatedCandidateIndex < drafts.length
    ) {
      relatedCandidateOrdinal = draft.relatedCandidateIndex;
    }

    out.push({
      ordinal: index,
      type,
      mentionKind,
      title,
      subject: clamp(draft.subject ?? "", SUBJECT_MAX),
      sourceExcerpt: excerpt,
      datePhrase: clamp(resolved.datePhrase || draft.datePhrase || "", 120),
      proposedDate: resolved.proposedDate
        ? parseCalendarDate(resolved.proposedDate)
        : null,
      dateUncertain: resolved.dateUncertain,
      estimatedMinutes,
      relatedCandidateOrdinal,
    });
  });

  // Drop prep links that point at non-commitment ordinals after filtering.
  const byOrdinal = new Map(out.map((c) => [c.ordinal, c]));
  for (const c of out) {
    if (c.relatedCandidateOrdinal == null) continue;
    const related = byOrdinal.get(c.relatedCandidateOrdinal);
    if (
      !related ||
      related.type === "STUDY_STEP" ||
      related.ordinal === c.ordinal
    ) {
      c.relatedCandidateOrdinal = null;
    }
  }

  // Re-number densely while preserving relative links.
  const ordered = out.sort((a, b) => a.ordinal - b.ordinal);
  const remap = new Map<number, number>();
  ordered.forEach((c, i) => remap.set(c.ordinal, i));
  return ordered.map((c, i) => ({
    ...c,
    ordinal: i,
    relatedCandidateOrdinal:
      c.relatedCandidateOrdinal != null
        ? (remap.get(c.relatedCandidateOrdinal) ?? null)
        : null,
  }));
}

/** Pure sanitizer for provider drafts (excerpt check, date resolve, link remap). Exported for unit tests. */
export function sanitizePlanExtractDrafts(
  drafts: PlanExtractCandidateDraft[],
  sourceText: string,
  diaryDate: string,
) {
  return sanitizeDrafts(drafts, sourceText, diaryDate).map((c) => ({
    ...c,
    proposedDate: formatCalendarDate(c.proposedDate),
  }));
}

export async function persistPlanExtractBatch(input: {
  childUserId: string;
  entryId: string;
  requestId: string;
  expectedRevision: number;
  provider: string;
  drafts: PlanExtractCandidateDraft[];
}): Promise<ExtractBatchView> {
  const { child, entry } = await requireOwnedEntry(input.childUserId, input.entryId);

  if (entry.revision !== input.expectedRevision) {
    throw new PlanExtractError(
      "Metin değiştiği için bu öneri artık geçerli değil.",
      "CONFLICT",
    );
  }

  const existing = await prisma.planExtractBatch.findUnique({
    where: { requestId: input.requestId },
    include: batchInclude,
  });
  if (existing) {
    if (existing.entryId !== entry.id || existing.childId !== child.id) {
      throw new PlanExtractError("Bu istek başka bir kayda ait.", "CONFLICT");
    }
    return toBatchView(existing, entry.revision, child.id);
  }

  const still = await prisma.journalEntry.findFirst({
    where: { id: entry.id, childId: child.id },
    select: { id: true, revision: true, body: true, originalBody: true, acceptedSummary: true, diaryDate: true },
  });
  if (!still) throw new PlanExtractError("Kayıt silindi.", "GONE");
  if (still.revision !== input.expectedRevision) {
    throw new PlanExtractError(
      "Metin değiştiği için bu öneri artık geçerli değil.",
      "CONFLICT",
    );
  }

  const sourceText = extractionSourceText(still);
  const diaryDate = formatCalendarDate(still.diaryDate)!;
  const sanitized = sanitizeDrafts(input.drafts, sourceText, diaryDate);

  // Newer READY batches for this entry become STALE when a fresh batch lands.
  await prisma.planExtractBatch.updateMany({
    where: { entryId: entry.id, status: "READY" },
    data: { status: "STALE" },
  });

  const created = await prisma.planExtractBatch.create({
    data: {
      entryId: entry.id,
      childId: child.id,
      requestId: input.requestId,
      sourceRevision: input.expectedRevision,
      diaryDate: still.diaryDate,
      status: "READY",
      provider: clamp(input.provider, 80),
      candidates: {
        create: sanitized.map((c) => ({
          ordinal: c.ordinal,
          type: c.type,
          mentionKind: c.mentionKind,
          title: c.title,
          subject: c.subject,
          sourceExcerpt: c.sourceExcerpt,
          datePhrase: c.datePhrase,
          proposedDate: c.proposedDate,
          dateUncertain: c.dateUncertain,
          estimatedMinutes: c.estimatedMinutes,
          relatedCandidateOrdinal: c.relatedCandidateOrdinal,
        })),
      },
    },
    include: batchInclude,
  });

  return toBatchView(created, entry.revision, child.id);
}

export type ApplySelection = {
  candidateId: string;
  selected: boolean;
  title?: string;
  subject?: string;
  /** Confirmed calendar date from the child (required for exam/course when selected). */
  confirmedDate?: string | null;
  dateUnknown?: boolean;
  estimatedMinutes?: number | null;
  plannedDate?: string | null;
  /** Link prep to an existing commitment. */
  relatedCommitmentId?: string | null;
  /** Link prep to another selected candidate in this apply (by candidate id). */
  relatedCandidateId?: string | null;
  /** When likely duplicates exist: skip this candidate or add a separate item. */
  duplicateDecision?: "skip" | "add_separate" | null;
  allowAfterDeadline?: boolean;
};

export type ApplyResult = {
  batch: ExtractBatchView;
  createdCommitmentIds: string[];
  createdStudyStepIds: string[];
  skippedCandidateIds: string[];
};

export async function applyPlanExtractBatch(input: {
  childUserId: string;
  batchId: string;
  applyRequestId: string;
  expectedSourceRevision: number;
  selections: ApplySelection[];
}): Promise<ApplyResult> {
  const child = await requireChildProfile(input.childUserId);
  const applyRequestId = input.applyRequestId.trim().slice(0, 80);
  if (applyRequestId.length < 8) {
    throw new PlanExtractError("applyRequestId gerekli.", "VALIDATION");
  }

  const existingApply = await prisma.planExtractBatch.findUnique({
    where: { applyRequestId },
    include: {
      ...batchInclude,
      entry: { select: { revision: true } },
    },
  });
  if (existingApply) {
    if (existingApply.childId !== child.id || existingApply.id !== input.batchId) {
      throw new PlanExtractError("Bu istek başka bir kayda ait.", "CONFLICT");
    }
    const view = await toBatchView(
      existingApply,
      existingApply.entry.revision,
      child.id,
    );
    return {
      batch: view,
      createdCommitmentIds: view.candidates
        .map((c) => c.appliedCommitmentId)
        .filter((id): id is string => Boolean(id)),
      createdStudyStepIds: view.candidates
        .map((c) => c.appliedStudyStepId)
        .filter((id): id is string => Boolean(id)),
      skippedCandidateIds: view.candidates
        .filter((c) => c.status === "SKIPPED")
        .map((c) => c.id),
    };
  }

  const batch = await prisma.planExtractBatch.findFirst({
    where: { id: input.batchId, childId: child.id },
    include: {
      ...batchInclude,
      entry: true,
    },
  });
  if (!batch) throw new PlanExtractError("Öneri bulunamadı.", "NOT_FOUND");

  // Entry deleted mid-flight
  if (!batch.entry) {
    throw new PlanExtractError("Kayıt silindiği için ekleme yapılmadı.", "GONE");
  }

  if (
    batch.status === "STALE" ||
    batch.sourceRevision !== batch.entry.revision ||
    batch.sourceRevision !== input.expectedSourceRevision
  ) {
    throw new PlanExtractError(
      "Günlük metni değişti. Önce yeniden öneri iste.",
      "CONFLICT",
    );
  }

  const byId = new Map(batch.candidates.map((c) => [c.id, c]));
  const selected = input.selections.filter((s) => s.selected);
  if (selected.length === 0) {
    throw new PlanExtractError("En az bir öneri seçmelisin.", "VALIDATION");
  }

  for (const sel of selected) {
    const cand = byId.get(sel.candidateId);
    if (!cand) {
      throw new PlanExtractError("Geçersiz aday seçimi.", "VALIDATION");
    }
    if (cand.status === "APPLIED") {
      continue;
    }
  }

  // Duplicate review gate
  const pendingForDup = selected
    .map((s) => byId.get(s.candidateId)!)
    .filter((c) => c.status === "PENDING");
  const dupMap = await findLikelyDuplicates(child.id, pendingForDup);
  const needsReview: Array<{
    candidateId: string;
    title: string;
    duplicates: ExtractCandidateView["likelyDuplicates"];
  }> = [];
  for (const sel of selected) {
    const cand = byId.get(sel.candidateId)!;
    if (cand.status !== "PENDING") continue;
    const dups = dupMap.get(cand.id) ?? [];
    if (dups.length === 0) continue;
    if (sel.duplicateDecision === "skip" || sel.duplicateDecision === "add_separate") {
      continue;
    }
    needsReview.push({
      candidateId: cand.id,
      title: cand.title,
      duplicates: dups,
    });
  }
  if (needsReview.length > 0) {
    throw new PlanExtractError(
      "Benzer plan öğeleri var. Atla veya ayrı ekle seç.",
      "DUPLICATE_REVIEW",
      { duplicates: needsReview },
    );
  }

  // Topological-ish order: commitments before study steps
  const ordered = selected.slice().sort((a, b) => {
    const ca = byId.get(a.candidateId)!;
    const cb = byId.get(b.candidateId)!;
    const rank = (t: PlanExtractCandidateType) => (t === "STUDY_STEP" ? 1 : 0);
    return rank(ca.type) - rank(cb.type) || ca.ordinal - cb.ordinal;
  });

  const createdCommitmentIds: string[] = [];
  const createdStudyStepIds: string[] = [];
  const skippedCandidateIds: string[] = [];
  const newlyCreatedByCandidateId = new Map<string, string>();

  // Claim applyRequestId early so concurrent retries collide safely.
  try {
    const claimed = await prisma.planExtractBatch.updateMany({
      where: {
        id: batch.id,
        applyRequestId: null,
        status: "READY",
        sourceRevision: input.expectedSourceRevision,
      },
      data: { applyRequestId },
    });
    if (claimed.count !== 1) {
      // Another apply may have won; re-read by applyRequestId
      const raced = await prisma.planExtractBatch.findUnique({
        where: { applyRequestId },
        include: { ...batchInclude, entry: { select: { revision: true } } },
      });
      if (raced && raced.id === batch.id) {
        const view = await toBatchView(raced, raced.entry.revision, child.id);
        return {
          batch: view,
          createdCommitmentIds: view.candidates
            .map((c) => c.appliedCommitmentId)
            .filter((id): id is string => Boolean(id)),
          createdStudyStepIds: view.candidates
            .map((c) => c.appliedStudyStepId)
            .filter((id): id is string => Boolean(id)),
          skippedCandidateIds: view.candidates
            .filter((c) => c.status === "SKIPPED")
            .map((c) => c.id),
        };
      }
      throw new PlanExtractError(
        "Bu öneriler zaten işleniyor veya geçersiz. Yenileyip tekrar dene.",
        "CONFLICT",
      );
    }
  } catch (error) {
    if (error instanceof PlanExtractError) throw error;
    // Unique violation on applyRequestId
    const raced = await prisma.planExtractBatch.findUnique({
      where: { applyRequestId },
      include: { ...batchInclude, entry: { select: { revision: true } } },
    });
    if (raced && raced.childId === child.id) {
      const view = await toBatchView(raced, raced.entry.revision, child.id);
      return {
        batch: view,
        createdCommitmentIds: view.candidates
          .map((c) => c.appliedCommitmentId)
          .filter((id): id is string => Boolean(id)),
        createdStudyStepIds: view.candidates
          .map((c) => c.appliedStudyStepId)
          .filter((id): id is string => Boolean(id)),
        skippedCandidateIds: view.candidates
          .filter((c) => c.status === "SKIPPED")
          .map((c) => c.id),
      };
    }
    throw error;
  }

  try {
    for (const sel of ordered) {
      const cand = byId.get(sel.candidateId)!;
      if (cand.status === "APPLIED") {
        if (cand.appliedCommitmentId) createdCommitmentIds.push(cand.appliedCommitmentId);
        if (cand.appliedStudyStepId) createdStudyStepIds.push(cand.appliedStudyStepId);
        continue;
      }
      if (cand.status === "SKIPPED") {
        skippedCandidateIds.push(cand.id);
        continue;
      }

      if (sel.duplicateDecision === "skip") {
        await prisma.planExtractCandidate.update({
          where: { id: cand.id },
          data: { status: "SKIPPED" },
        });
        skippedCandidateIds.push(cand.id);
        continue;
      }

      const title = clamp(sel.title ?? cand.title, TITLE_MAX);
      if (!title) throw new PlanExtractError("Başlık gerekli.", "VALIDATION");
      const subject = clamp(sel.subject ?? cand.subject, SUBJECT_MAX);
      const clientRequestId = `${applyRequestId}:${cand.id}`;

      if (cand.type === "STUDY_STEP") {
        let relatedCommitmentId: string | null =
          sel.relatedCommitmentId?.trim() || null;

        if (sel.relatedCandidateId) {
          const relatedCand = byId.get(sel.relatedCandidateId);
          if (!relatedCand || relatedCand.type === "STUDY_STEP") {
            throw new PlanExtractError(
              "Hazırlık adımı geçerli bir ödev/sınava bağlanmalı.",
              "VALIDATION",
            );
          }
          const relatedSel = selected.find((s) => s.candidateId === sel.relatedCandidateId);
          if (!relatedSel?.selected) {
            throw new PlanExtractError(
              "Bağlı öneri seçilmedi. Tek başına ekle veya mevcut bir iş seç.",
              "VALIDATION",
            );
          }
          const createdId = newlyCreatedByCandidateId.get(sel.relatedCandidateId);
          const appliedId = relatedCand.appliedCommitmentId;
          relatedCommitmentId = createdId || appliedId || null;
          if (!relatedCommitmentId) {
            throw new PlanExtractError(
              "Bağlı iş henüz oluşturulamadı.",
              "VALIDATION",
            );
          }
        } else if (
          cand.relatedCandidateOrdinal != null &&
          !sel.relatedCommitmentId &&
          sel.relatedCandidateId === undefined
        ) {
          // Default: try linked batch candidate if it was also selected
          const relatedCand = batch.candidates.find(
            (c) => c.ordinal === cand.relatedCandidateOrdinal,
          );
          if (relatedCand) {
            const relatedSel = selected.find((s) => s.candidateId === relatedCand.id);
            if (relatedSel?.selected) {
              relatedCommitmentId =
                newlyCreatedByCandidateId.get(relatedCand.id) ||
                relatedCand.appliedCommitmentId ||
                null;
              if (!relatedCommitmentId) {
                throw new PlanExtractError(
                  "Bağlı öneri seçilmedi. Tek başına ekle veya mevcut bir iş seç.",
                  "VALIDATION",
                );
              }
            }
            // If related not selected: allow standalone (relatedCommitmentId stays null)
          }
        }

        const plannedDate =
          sel.plannedDate !== undefined ? sel.plannedDate : null;
        const estimatedMinutes =
          sel.estimatedMinutes !== undefined
            ? sel.estimatedMinutes
            : cand.estimatedMinutes;

        const step = await createStudyStep({
          childUserId: input.childUserId,
          title,
          subject,
          plannedDate,
          estimatedMinutes,
          relatedCommitmentId,
          allowAfterDeadline: sel.allowAfterDeadline === true,
          clientRequestId,
        });
        createdStudyStepIds.push(step.id);
        await prisma.planExtractCandidate.update({
          where: { id: cand.id },
          data: {
            status: "APPLIED",
            appliedStudyStepId: step.id,
            applyClientRequestId: clientRequestId,
            title,
            subject,
          },
        });
      } else {
        const type = cand.type as PlanCommitmentType;
        let dueDate: string | null | undefined;
        let eventDate: string | null | undefined;
        let dateUnknown = false;

        if (type === "HOMEWORK") {
          if (sel.dateUnknown) {
            dateUnknown = true;
            dueDate = null;
          } else if (sel.confirmedDate?.trim()) {
            dueDate = sel.confirmedDate.trim();
          } else if (cand.proposedDate) {
            throw new PlanExtractError(
              `"${title}" için tarihi onaylamalısın.`,
              "VALIDATION",
            );
          } else {
            dateUnknown = true;
            dueDate = null;
          }
        } else {
          const confirmed = sel.confirmedDate?.trim() || null;
          if (!confirmed) {
            throw new PlanExtractError(
              cand.dateUncertain
                ? `"${title}" tarihi belirsiz. Lütfen tarihi onayla.`
                : `"${title}" için etkinlik tarihini onaylamalısın.`,
              "VALIDATION",
            );
          }
          eventDate = confirmed;
        }

        const commitment = await createCommitment({
          childUserId: input.childUserId,
          type,
          title,
          subject,
          dueDate,
          eventDate,
          dateUnknown,
          clientRequestId,
        });
        createdCommitmentIds.push(commitment.id);
        newlyCreatedByCandidateId.set(cand.id, commitment.id);
        await prisma.planExtractCandidate.update({
          where: { id: cand.id },
          data: {
            status: "APPLIED",
            appliedCommitmentId: commitment.id,
            applyClientRequestId: clientRequestId,
            title,
            subject,
          },
        });
      }
    }

    await prisma.planExtractBatch.update({
      where: { id: batch.id },
      data: { status: "APPLIED" },
    });
  } catch (error) {
    // Clear claim on failure so the child can retry (unless unique apply already finished)
    if (!(error instanceof PlanExtractError && error.code === "DUPLICATE_REVIEW")) {
      const stillClaimed = await prisma.planExtractBatch.findUnique({
        where: { id: batch.id },
        select: { applyRequestId: true, status: true },
      });
      if (
        stillClaimed?.applyRequestId === applyRequestId &&
        stillClaimed.status !== "APPLIED"
      ) {
        // Keep applyRequestId for partial idempotency of created clientRequestIds;
        // mark batch READY again only if nothing applied.
        const appliedCount = await prisma.planExtractCandidate.count({
          where: { batchId: batch.id, status: "APPLIED" },
        });
        if (appliedCount === 0) {
          await prisma.planExtractBatch.update({
            where: { id: batch.id },
            data: { applyRequestId: null, status: "READY" },
          });
        }
      }
    }
    if (error instanceof PlanError) {
      const code =
        error.code === "CONFLICT"
          ? "CONFLICT"
          : error.code === "GONE" || error.code === "NOT_FOUND"
            ? error.code
            : "VALIDATION";
      throw new PlanExtractError(error.message, code, error.details);
    }
    throw error;
  }

  const fresh = await prisma.planExtractBatch.findUniqueOrThrow({
    where: { id: batch.id },
    include: { ...batchInclude, entry: { select: { revision: true } } },
  });
  const view = await toBatchView(fresh, fresh.entry.revision, child.id);
  return {
    batch: view,
    createdCommitmentIds,
    createdStudyStepIds,
    skippedCandidateIds,
  };
}

export async function listOpenCommitmentsForExtract(input: {
  childUserId: string;
}) {
  const child = await requireChildProfile(input.childUserId);
  const rows = await prisma.planCommitment.findMany({
    where: { childId: child.id, completedAt: null },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      id: true,
      type: true,
      title: true,
      dueDate: true,
      eventDate: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    dueDate: formatCalendarDate(r.dueDate),
    eventDate: formatCalendarDate(r.eventDate),
  }));
}
