import { randomUUID } from "crypto";
import {
  getParentGuidanceProvider,
  getSummarizationProvider,
} from "@/lib/ai";
import { ProviderError } from "@/lib/ai/types";
import { touchJournalNotificationsForAi } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

const AI_CLAIM_LEASE_MS = 60_000;
const AI_MAX_ATTEMPTS = 3;
const AI_BATCH_SIZE = 10;

export async function enqueueGuardianAiJob(input: {
  entryId: string;
  sourceRevision: number;
}) {
  const entry = await prisma.journalEntry.findUnique({
    where: { id: input.entryId },
    select: { id: true, visibility: true, body: true },
  });
  if (!entry || entry.visibility !== "GUARDIAN_VISIBLE") return;
  if (!entry.body.trim()) return;

  await prisma.journalGuardianAi.upsert({
    where: { entryId: entry.id },
    create: {
      entryId: entry.id,
      sourceRevision: input.sourceRevision,
      status: "PENDING",
      summaryText: "",
      conversationOpener: "",
      supportAction: "",
      lastError: "",
    },
    update: {
      sourceRevision: input.sourceRevision,
      status: "STALE",
      lastError: "",
    },
  });

  await prisma.journalAiJob.updateMany({
    where: {
      entryId: entry.id,
      sourceRevision: { lt: input.sourceRevision },
      status: { in: ["PENDING", "CLAIMED"] },
    },
    data: { status: "CANCELLED", claimToken: null },
  });

  await prisma.journalAiJob.upsert({
    where: {
      entryId_sourceRevision: {
        entryId: entry.id,
        sourceRevision: input.sourceRevision,
      },
    },
    create: {
      entryId: entry.id,
      sourceRevision: input.sourceRevision,
      status: "PENDING",
    },
    update: {
      status: "PENDING",
      claimToken: null,
      claimedAt: null,
      claimExpiresAt: null,
      lastError: "",
      attemptCount: 0,
    },
  });
}

export async function cancelAiJobsForEntry(entryId: string) {
  await prisma.journalAiJob.updateMany({
    where: { entryId, status: { in: ["PENDING", "CLAIMED"] } },
    data: { status: "CANCELLED", claimToken: null },
  });
}

export type GuardianAiView = {
  status:
    | "QUEUED"
    | "PROCESSING"
    | "READY"
    | "FAILED"
    | "STALE"
    | "UNAVAILABLE";
  sourceRevision: number | null;
  summaryText: string | null;
  conversationOpener: string | null;
  supportAction: string | null;
  label: string;
  reason?: string;
  canRetry: boolean;
  jobStatus?: string | null;
  attemptCount?: number;
};

export async function getGuardianAiForEntry(
  entryId: string,
  entryRevision: number,
): Promise<GuardianAiView> {
  const summaryConfigured = getSummarizationProvider().isConfigured();
  const guidanceConfigured = getParentGuidanceProvider().isConfigured();
  if (!summaryConfigured && !guidanceConfigured) {
    return {
      status: "UNAVAILABLE",
      sourceRevision: null,
      summaryText: null,
      conversationOpener: null,
      supportAction: null,
      label: "AI önerisi",
      reason: "Yapay zekâ şu an yapılandırılmamış.",
      canRetry: false,
    };
  }

  const [row, job] = await Promise.all([
    prisma.journalGuardianAi.findUnique({ where: { entryId } }),
    prisma.journalAiJob.findFirst({
      where: { entryId, sourceRevision: entryRevision },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const baseLabel = "AI önerisi · Kaydedilen metne dayanır";

  if (row?.status === "READY" && row.sourceRevision === entryRevision) {
    return {
      status: "READY",
      sourceRevision: row.sourceRevision,
      summaryText: row.summaryText.trim() || null,
      conversationOpener: row.conversationOpener.trim() || null,
      supportAction: row.supportAction.trim() || null,
      label: `${baseLabel} · Çocuğun kendi sözü değildir`,
      canRetry: false,
      jobStatus: job?.status ?? null,
      attemptCount: job?.attemptCount,
    };
  }

  if (job?.status === "FAILED" || (row?.status === "FAILED" && row.sourceRevision === entryRevision)) {
    return {
      status: "FAILED",
      sourceRevision: row?.sourceRevision ?? job?.sourceRevision ?? null,
      summaryText: null,
      conversationOpener: null,
      supportAction: null,
      label: baseLabel,
      reason:
        row?.lastError ||
        job?.lastError ||
        "Özet veya yaklaşım önerisi hazırlanamadı.",
      canRetry: true,
      jobStatus: job?.status ?? null,
      attemptCount: job?.attemptCount,
    };
  }

  if (job?.status === "CLAIMED") {
    return {
      status: "PROCESSING",
      sourceRevision: entryRevision,
      summaryText: null,
      conversationOpener: null,
      supportAction: null,
      label: baseLabel,
      reason: "Özet işleniyor… Kaydedilen anlatım yukarıda duruyor.",
      canRetry: false,
      jobStatus: job.status,
      attemptCount: job.attemptCount,
    };
  }

  if (job?.status === "PENDING") {
    return {
      status: "QUEUED",
      sourceRevision: entryRevision,
      summaryText: null,
      conversationOpener: null,
      supportAction: null,
      label: baseLabel,
      reason:
        "Özet sırada bekliyor. Yerel geliştirmede `npm run jobs:worker` veya `npm run dev` çalışıyor olmalı.",
      canRetry: false,
      jobStatus: job.status,
      attemptCount: job.attemptCount,
    };
  }

  if (!row) {
    return {
      status: "QUEUED",
      sourceRevision: null,
      summaryText: null,
      conversationOpener: null,
      supportAction: null,
      label: baseLabel,
      reason: "Özet henüz planlanmadı.",
      canRetry: true,
    };
  }

  if (row.sourceRevision !== entryRevision || row.status === "STALE") {
    return {
      status: "STALE",
      sourceRevision: row.sourceRevision,
      summaryText: null,
      conversationOpener: null,
      supportAction: null,
      label: baseLabel,
      reason: "Metin güncellendi; yeni özet bekleniyor.",
      canRetry: true,
      jobStatus: job?.status ?? null,
      attemptCount: job?.attemptCount,
    };
  }

  return {
    status: "QUEUED",
    sourceRevision: row.sourceRevision,
    summaryText: null,
    conversationOpener: null,
    supportAction: null,
    label: baseLabel,
    canRetry: true,
    jobStatus: job?.status ?? null,
    attemptCount: job?.attemptCount,
  };
}

/** Authorized child or guardian retry: coalesce into one PENDING job for current revision. */
export async function retryGuardianAiForCurrentRevision(entryId: string) {
  const entry = await prisma.journalEntry.findUnique({
    where: { id: entryId },
    select: { id: true, visibility: true, body: true, revision: true },
  });
  if (!entry || entry.visibility !== "GUARDIAN_VISIBLE" || !entry.body.trim()) {
    return { ok: false as const, reason: "not-eligible" };
  }
  await enqueueGuardianAiJob({
    entryId: entry.id,
    sourceRevision: entry.revision,
  });
  return { ok: true as const, revision: entry.revision };
}

export async function processJournalAiJobs(input?: { batchSize?: number }) {
  const batchSize = input?.batchSize ?? AI_BATCH_SIZE;
  const now = new Date();

  await prisma.journalAiJob.updateMany({
    where: {
      status: "CLAIMED",
      claimExpiresAt: { lt: now },
    },
    data: { status: "PENDING", claimToken: null, claimedAt: null, claimExpiresAt: null },
  });

  const pending = await prisma.journalAiJob.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  const result = { claimed: 0, done: 0, failed: 0, cancelled: 0 };

  for (const job of pending) {
    const claimToken = randomUUID();
    const claimed = await prisma.journalAiJob.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: {
        status: "CLAIMED",
        claimToken,
        claimedAt: now,
        claimExpiresAt: new Date(now.getTime() + AI_CLAIM_LEASE_MS),
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) continue;
    result.claimed += 1;

    const entry = await prisma.journalEntry.findUnique({
      where: { id: job.entryId },
    });
    if (!entry || entry.visibility !== "GUARDIAN_VISIBLE") {
      await prisma.journalAiJob.updateMany({
        where: { id: job.id, claimToken, status: "CLAIMED" },
        data: { status: "CANCELLED", claimToken: null, lastError: "entry-gone" },
      });
      result.cancelled += 1;
      continue;
    }

    if (job.sourceRevision !== entry.revision) {
      await prisma.journalAiJob.updateMany({
        where: { id: job.id, claimToken, status: "CLAIMED" },
        data: {
          status: "CANCELLED",
          claimToken: null,
          lastError: "stale-revision",
        },
      });
      result.cancelled += 1;
      continue;
    }

    if (!entry.body.trim()) {
      await prisma.journalAiJob.updateMany({
        where: { id: job.id, claimToken, status: "CLAIMED" },
        data: { status: "CANCELLED", claimToken: null, lastError: "empty-body" },
      });
      result.cancelled += 1;
      continue;
    }

    try {
      const summarizer = getSummarizationProvider();
      const guidance = getParentGuidanceProvider();
      let summaryText = "";
      let conversationOpener = "";
      let supportAction = "";
      let provider = "";

      if (summarizer.isConfigured()) {
        const sum = await summarizer.summarize({ sourceText: entry.body });
        summaryText = sum.summary;
        provider = sum.provider;
      }
      if (guidance.isConfigured()) {
        const tip = await guidance.generate({
          parentMessage: "",
          supportRequest: "",
          narrativeText: entry.body,
        });
        conversationOpener = tip.conversationOpener;
        supportAction = tip.supportAction;
        provider = provider || tip.provider;
      }

      if (!summaryText && !conversationOpener && !supportAction) {
        throw new ProviderError(
          "Yapay zekâ şu an yapılandırılmamış.",
          "NOT_CONFIGURED",
        );
      }

      const still = await prisma.journalEntry.findUnique({
        where: { id: entry.id },
        select: { id: true, revision: true, visibility: true },
      });
      if (
        !still ||
        still.visibility !== "GUARDIAN_VISIBLE" ||
        still.revision !== job.sourceRevision
      ) {
        await prisma.journalAiJob.updateMany({
          where: { id: job.id, claimToken, status: "CLAIMED" },
          data: {
            status: "CANCELLED",
            claimToken: null,
            lastError: "revision-changed",
          },
        });
        result.cancelled += 1;
        continue;
      }

      await prisma.journalGuardianAi.upsert({
        where: { entryId: entry.id },
        create: {
          entryId: entry.id,
          sourceRevision: job.sourceRevision,
          status: "READY",
          summaryText,
          conversationOpener,
          supportAction,
          provider,
          lastError: "",
        },
        update: {
          sourceRevision: job.sourceRevision,
          status: "READY",
          summaryText,
          conversationOpener,
          supportAction,
          provider,
          lastError: "",
        },
      });

      await prisma.journalAiJob.updateMany({
        where: { id: job.id, claimToken, status: "CLAIMED" },
        data: { status: "DONE", claimToken: null, lastError: "" },
      });
      await touchJournalNotificationsForAi(entry.id);
      result.done += 1;
    } catch (error) {
      const message =
        error instanceof ProviderError
          ? error.message
          : error instanceof Error
            ? error.message
            : "unknown";
      const attempts = job.attemptCount + 1;
      const terminal = attempts >= AI_MAX_ATTEMPTS;
      await prisma.journalAiJob.updateMany({
        where: { id: job.id, claimToken, status: "CLAIMED" },
        data: {
          status: terminal ? "FAILED" : "PENDING",
          claimToken: null,
          claimedAt: null,
          claimExpiresAt: null,
          lastError: message.slice(0, 400),
        },
      });
      await prisma.journalGuardianAi.upsert({
        where: { entryId: entry.id },
        create: {
          entryId: entry.id,
          sourceRevision: job.sourceRevision,
          status: "FAILED",
          lastError: message.slice(0, 400),
        },
        update: {
          sourceRevision: job.sourceRevision,
          status: "FAILED",
          lastError: message.slice(0, 400),
        },
      });
      result.failed += 1;
    }
  }

  return result;
}
