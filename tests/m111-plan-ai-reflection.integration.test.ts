import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  setParentGuidanceProviderForTests,
  setSummarizationProviderForTests,
} from "@/lib/ai";
import type { ParentGuidanceProvider, SummarizationProvider } from "@/lib/ai/types";
import {
  acceptGuardianInvitation,
  inviteGuardian,
  removeGuardianAccess,
} from "@/lib/guardian";
import { createJournalEntry, getParentVisibleEntry, updateJournalBody } from "@/lib/journal";
import {
  enqueueGuardianAiJob,
  getGuardianAiForEntry,
  processJournalAiJobs,
  retryGuardianAiForCurrentRevision,
} from "@/lib/journal-ai";
import { listNotifications } from "@/lib/notifications";
import { applyPlanExtractBatch, persistPlanExtractBatch } from "@/lib/plan-extract";
import {
  createCommitment,
  createStudyStep,
  getParentStudyStep,
  setStudyStepStatus,
  updateCommitment,
  updateStudyStep,
  updateStudyStepCompletionReflection,
} from "@/lib/plan";
import {
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  prisma,
} from "./helpers";

async function verifyParentEmail(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: true },
  });
}

function stubSummary(text = "Kısa özet"): SummarizationProvider {
  return {
    name: "test-summary",
    isConfigured: () => true,
    async summarize() {
      return { summary: text, provider: "test" };
    },
  };
}

function stubGuidance(): ParentGuidanceProvider {
  return {
    name: "test-guidance",
    isConfigured: () => true,
    async generate() {
      return {
        conversationOpener: "Bugün parkta ne oldu?",
        supportAction: "İstersen birlikte kısa bir yürüyüş planlayın.",
        provider: "test",
      };
    },
  };
}

function failingSummary(): SummarizationProvider {
  return {
    name: "fail-summary",
    isConfigured: () => true,
    async summarize() {
      throw new Error("provider down");
    },
  };
}

describe("Milestone 11.1 AI / reflection / plan notifications", () => {
  beforeEach(() => {
    setSummarizationProviderForTests(stubSummary());
    setParentGuidanceProviderForTests(stubGuidance());
  });
  afterEach(() => {
    setSummarizationProviderForTests(null);
    setParentGuidanceProviderForTests(null);
  });

  it("distinguishes queued vs failed AI and retries without duplicate active jobs", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    let entry = await createJournalEntry({ childUserId, body: "" });
    entry = await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "Sentetik günlük: parkta top oynadım ve matematik ödevimi bitirdim.",
      expectedRevision: entry.revision,
      markSaved: true,
    });

    const queued = await getGuardianAiForEntry(entry.id, entry.revision);
    expect(queued.status).toBe("QUEUED");
    expect(queued.canRetry).toBe(false);

    setSummarizationProviderForTests(failingSummary());
    for (let i = 0; i < 6; i++) {
      await processJournalAiJobs({ batchSize: 10 });
    }
    const failed = await getGuardianAiForEntry(entry.id, entry.revision);
    expect(failed.status).toBe("FAILED");
    expect(failed.canRetry).toBe(true);

    setSummarizationProviderForTests(stubSummary("Yenilenen özet"));
    await retryGuardianAiForCurrentRevision(entry.id);
    const afterRetry = await getGuardianAiForEntry(entry.id, entry.revision);
    expect(["QUEUED", "PROCESSING", "READY"]).toContain(afterRetry.status);

    const pendingJobs = await prisma.journalAiJob.count({
      where: {
        entryId: entry.id,
        status: { in: ["PENDING", "CLAIMED"] },
      },
    });
    expect(pendingJobs).toBeLessThanOrEqual(1);

    await processJournalAiJobs({ batchSize: 10 });
    const ready = await getGuardianAiForEntry(entry.id, entry.revision);
    expect(ready.status).toBe("READY");
    expect(ready.summaryText).toContain("Yenilenen");
  });

  it("rejects stale-revision AI overwrite after a newer save", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    let entry = await createJournalEntry({ childUserId, body: "" });
    entry = await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "İlk sentetik anlatım.",
      expectedRevision: entry.revision,
      markSaved: true,
    });
    const firstRevision = entry.revision;
    await enqueueGuardianAiJob({
      entryId: entry.id,
      sourceRevision: firstRevision,
    });

    entry = await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "İkinci sentetik anlatım; önceki özet geçersiz.",
      expectedRevision: firstRevision,
      markSaved: true,
    });

    await processJournalAiJobs({ batchSize: 20 });
    const view = await getParentVisibleEntry(parent.user.id, entry.id);
    expect(view.body).toContain("İkinci");
    expect(view.ai.sourceRevision).not.toBe(firstRevision);
  });

  it("saves completion reflection, clears on reopen, rejects stale write", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    const step = await createStudyStep({
      childUserId,
      title: "Matematik 10 soru",
      plannedDate: "2026-09-13",
    });
    const done = await setStudyStepStatus({
      childUserId,
      id: step.id,
      expectedRevision: step.revision,
      status: "DONE",
    });
    expect(done.completedAt).toBeTruthy();

    const withNote = await updateStudyStepCompletionReflection({
      childUserId,
      id: step.id,
      expectedRevision: done.revision,
      reflection: "10 soru çözdüm, iki soruda zorlandım.",
    });
    expect(withNote.completionReflection).toContain("10 soru");

    const parentView = await getParentStudyStep(parent.user.id, step.id);
    expect(parentView.studyStep.completionReflection).toContain("zorlandım");

    const reopened = await setStudyStepStatus({
      childUserId,
      id: step.id,
      expectedRevision: withNote.revision,
      status: "TODO",
    });
    expect(reopened.completedAt).toBeNull();
    expect(reopened.completionReflection).toBe("");

    await expect(
      updateStudyStepCompletionReflection({
        childUserId,
        id: step.id,
        expectedRevision: withNote.revision,
        reflection: "Geç kalan not",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("notifies guardians on create/schedule/complete with dedupe; extract is grouped", async () => {
    const parent = await createParent();
    await verifyParentEmail(parent.user.id);
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    const second = await createParent({ email: `g2_${Date.now()}@example.com` });
    await verifyParentEmail(second.user.id);
    const { token } = await inviteGuardian({
      managerUserId: parent.user.id,
      childId: child.id,
      email: second.email,
    });
    await acceptGuardianInvitation({
      token,
      acceptorUserId: second.user.id,
    });

    const exam = await createCommitment({
      childUserId,
      type: "EXAM",
      title: "Fen sınavı",
      eventDate: "2026-09-20",
    });
    const createdNotifs = await listNotifications({
      recipientUserId: parent.user.id,
      filter: "all",
      limit: 40,
    });
    expect(
      createdNotifs.items.filter((n) => n.kind === "PLAN_RECORD_CREATED").length,
    ).toBe(1);

    const secondCreated = await listNotifications({
      recipientUserId: second.user.id,
      filter: "all",
      limit: 40,
    });
    expect(
      secondCreated.items.filter((n) => n.kind === "PLAN_RECORD_CREATED").length,
    ).toBe(1);

    const titled = await updateCommitment({
      childUserId,
      id: exam.id,
      expectedRevision: exam.revision,
      title: "Fen sınavı (güncellendi)",
    });
    const afterTitle = await listNotifications({
      recipientUserId: parent.user.id,
      filter: "all",
      limit: 40,
    });
    expect(
      afterTitle.items.filter((n) => n.kind === "PLAN_SCHEDULE_CHANGED").length,
    ).toBe(0);

    await updateCommitment({
      childUserId,
      id: exam.id,
      expectedRevision: titled.revision,
      eventDate: "2026-09-22",
    });
    const afterMove = await listNotifications({
      recipientUserId: parent.user.id,
      filter: "all",
      limit: 40,
    });
    expect(
      afterMove.items.filter((n) => n.kind === "PLAN_SCHEDULE_CHANGED").length,
    ).toBe(1);

    const step = await createStudyStep({
      childUserId,
      title: "Fen tekrar",
      plannedDate: "2026-09-18",
    });
    const done = await setStudyStepStatus({
      childUserId,
      id: step.id,
      expectedRevision: step.revision,
      status: "DONE",
    });
    await updateStudyStepCompletionReflection({
      childUserId,
      id: step.id,
      expectedRevision: done.revision,
      reflection: "Kısa not",
    });
    const afterDone = await listNotifications({
      recipientUserId: parent.user.id,
      filter: "all",
      limit: 40,
    });
    const completion = afterDone.items.filter((n) => n.kind === "PLAN_STEP_COMPLETED");
    expect(completion.length).toBe(1);
    expect(completion[0]!.body).toContain("notunu");
    expect(completion[0]!.body).not.toContain("Kısa not");

    const narrative =
      "Yarın matematik ödevi var ve salı günü İngilizce sınavı. Kelime tekrarı da yapacağım.";
    let entry = await createJournalEntry({ childUserId, body: "" });
    entry = await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: narrative,
      expectedRevision: entry.revision,
      markSaved: true,
    });

    const batch = await persistPlanExtractBatch({
      childUserId,
      entryId: entry.id,
      requestId: `req_${Date.now()}`,
      expectedRevision: entry.revision,
      provider: "test",
      drafts: [
        {
          type: "HOMEWORK",
          mentionKind: "EXPLICIT",
          title: "Matematik ödevi",
          subject: "Matematik",
          sourceExcerpt: "matematik ödevi var",
          proposedDate: "2026-09-14",
          dateUncertain: false,
        },
        {
          type: "EXAM",
          mentionKind: "EXPLICIT",
          title: "İngilizce sınavı",
          subject: "İngilizce",
          sourceExcerpt: "İngilizce sınavı",
          proposedDate: "2026-09-16",
          dateUncertain: false,
        },
        {
          type: "STUDY_STEP",
          mentionKind: "PREPARATION",
          title: "Kelime tekrarı",
          subject: "İngilizce",
          sourceExcerpt: "Kelime tekrarı da yapacağım",
          proposedDate: "2026-09-15",
        },
      ],
    });

    const beforeExtract = (
      await listNotifications({
        recipientUserId: parent.user.id,
        filter: "all",
        limit: 80,
      })
    ).items.filter((n) => n.kind === "PLAN_EXTRACT_BATCH").length;

    const applyRequestId = `apply_${Date.now()}`;
    const applyPayload = {
      childUserId,
      batchId: batch.id,
      applyRequestId,
      expectedSourceRevision: batch.sourceRevision,
      selections: batch.candidates.map((c) => ({
        candidateId: c.id,
        selected: true,
        confirmedDate: c.proposedDate,
        plannedDate: c.type === "STUDY_STEP" ? c.proposedDate : undefined,
      })),
    };
    await applyPlanExtractBatch(applyPayload);
    await applyPlanExtractBatch(applyPayload);

    const extractNotifs = (
      await listNotifications({
        recipientUserId: parent.user.id,
        filter: "all",
        limit: 80,
      })
    ).items.filter((n) => n.kind === "PLAN_EXTRACT_BATCH");
    expect(extractNotifs.length - beforeExtract).toBe(1);
    expect(extractNotifs[0]!.title).toMatch(/3 yeni kayıt/);

    const extractSecond = (
      await listNotifications({
        recipientUserId: second.user.id,
        filter: "all",
        limit: 80,
      })
    ).items.filter((n) => n.kind === "PLAN_EXTRACT_BATCH");
    expect(extractSecond.length).toBe(1);

    await prisma.appNotification.update({
      where: { id: extractNotifs[0]!.id },
      data: { readAt: new Date() },
    });
    const secondUnread = await listNotifications({
      recipientUserId: second.user.id,
      filter: "unread",
      limit: 40,
    });
    expect(secondUnread.items.some((n) => n.kind === "PLAN_EXTRACT_BATCH")).toBe(true);

    await removeGuardianAccess({
      managerUserId: parent.user.id,
      childId: child.id,
      targetUserId: second.user.id,
    });
    await expect(getParentStudyStep(second.user.id, step.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("blocks guardian from writing reflection and cross-child access", async () => {
    const parentA = await createParent();
    const childA = await onboardParentWithChild(parentA.user.id);
    await pairChildAndGetCookie(parentA.user.id, childA.id);
    const childAUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: childA.id } })
    ).userId!;

    const parentB = await createParent({ email: `pb_${Date.now()}@example.com` });
    const childB = await onboardParentWithChild(parentB.user.id);
    await pairChildAndGetCookie(parentB.user.id, childB.id);

    const step = await createStudyStep({
      childUserId: childAUserId,
      title: "Özel adım",
      plannedDate: "2026-09-13",
    });
    const done = await setStudyStepStatus({
      childUserId: childAUserId,
      id: step.id,
      expectedRevision: step.revision,
      status: "DONE",
    });

    await expect(
      updateStudyStepCompletionReflection({
        childUserId: parentA.user.id,
        id: step.id,
        expectedRevision: done.revision,
        reflection: "veli notu",
      }),
    ).rejects.toBeTruthy();

    await expect(getParentStudyStep(parentB.user.id, step.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("reschedule does not clear reflection; repeating DONE keeps metadata", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    const step = await createStudyStep({
      childUserId,
      title: "Tekrar",
      plannedDate: "2026-09-13",
    });
    const done = await setStudyStepStatus({
      childUserId,
      id: step.id,
      expectedRevision: step.revision,
      status: "DONE",
    });
    const noted = await updateStudyStepCompletionReflection({
      childUserId,
      id: step.id,
      expectedRevision: done.revision,
      reflection: "Korunmalı not",
    });
    const moved = await updateStudyStep({
      childUserId,
      id: step.id,
      expectedRevision: noted.revision,
      plannedDate: "2026-09-14",
    });
    expect(moved.completionReflection).toBe("Korunmalı not");
    expect(moved.completedAt).toBe(noted.completedAt);

    const again = await setStudyStepStatus({
      childUserId,
      id: step.id,
      expectedRevision: moved.revision,
      status: "DONE",
    });
    expect(again.completionReflection).toBe("Korunmalı not");
    expect(again.completedAt).toBe(noted.completedAt);
  });
});
