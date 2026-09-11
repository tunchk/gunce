import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { POST as extractRoute, GET as getExtractRoute } from "@/app/api/child/journal/[id]/plan-extract/route";
import { POST as applyRoute } from "@/app/api/child/journal/[id]/plan-extract/apply/route";
import { GET as getParentPlan } from "@/app/api/parent/plan/route";
import {
  setPlanExtractProviderForTests,
} from "@/lib/ai";
import { createTestPlanExtractProvider } from "@/lib/ai/test-providers";
import { createJournalEntry, deleteJournalEntry, updateJournalBody } from "@/lib/journal";
import { parseCalendarDate } from "@/lib/plan-dates";
import { resolvePlanExtractDate, excerptOccursInSource } from "@/lib/plan-extract-dates";
import {
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  prisma,
  request,
  signInAndGetCookie,
} from "./helpers";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

const ACCEPTANCE_TEXT =
  "Yarın Almanca kelime sınavım var. Bu akşam kelimelere çalışmam lazım. Basketbolda güzel bir pas verdim. Matematik ödevinin teslim tarihini bilmiyorum.";

async function setupChild(timeZone = "Europe/Berlin") {
  const parent = await createParent();
  const child = await onboardParentWithChild(parent.user.id);
  await prisma.childProfile.update({
    where: { id: child.id },
    data: { timeZone },
  });
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (
    await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
  ).userId!;
  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  return { parent, child, childCookie, childUserId, parentCookie };
}

async function entryWithDiary(
  childUserId: string,
  body: string,
  diaryDate = "2026-09-10",
) {
  const entry = await createJournalEntry({ childUserId, body });
  await prisma.journalEntry.update({
    where: { id: entry.id },
    data: { diaryDate: parseCalendarDate(diaryDate) },
  });
  return { ...entry, diaryDate };
}

describe("Plan extract from journal (Milestone 6)", () => {
  beforeEach(() => {
    setPlanExtractProviderForTests(createTestPlanExtractProvider());
  });

  afterEach(() => {
    setPlanExtractProviderForTests(null);
  });

  it("resolves relative dates against diary date and validates excerpts", () => {
    expect(
      resolvePlanExtractDate({ diaryDate: "2026-09-10", datePhrase: "yarın" })
        .proposedDate,
    ).toBe("2026-09-11");
    expect(
      resolvePlanExtractDate({ diaryDate: "2026-09-10", datePhrase: "bu akşam" })
        .proposedDate,
    ).toBe("2026-09-10");
    const uncertain = resolvePlanExtractDate({
      diaryDate: "2026-09-10",
      datePhrase: "Galiba cuma",
      aiUncertain: true,
    });
    expect(uncertain.dateUncertain).toBe(true);
    expect(uncertain.proposedDate).toBe("2026-09-11"); // Friday on/after Thu
    expect(excerptOccursInSource("kelime sınavım var", ACCEPTANCE_TEXT)).toBe(true);
    expect(excerptOccursInSource("uydurma alıntı", ACCEPTANCE_TEXT)).toBe(false);
  });

  it("denies unauthenticated, cross-child, and parent access", async () => {
    const a = await setupChild();
    const b = await setupChild();
    const entry = await entryWithDiary(a.childUserId, ACCEPTANCE_TEXT);

    const unauth = await extractRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/plan-extract`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ expectedRevision: entry.revision }),
      }),
      params(entry.id),
    );
    expect(unauth.status).toBe(401);

    const cross = await extractRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/plan-extract`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: b.childCookie,
        },
        body: JSON.stringify({ expectedRevision: entry.revision }),
      }),
      params(entry.id),
    );
    expect(cross.status).toBe(404);

    const parentTry = await extractRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/plan-extract`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: a.parentCookie,
        },
        body: JSON.stringify({ expectedRevision: entry.revision }),
      }),
      params(entry.id),
    );
    expect(parentTry.status).toBe(403);
  });

  it("generates candidates without mutating the plan; applies only selected", async () => {
    const { childCookie, childUserId, parentCookie, child } = await setupChild();
    const entry = await entryWithDiary(childUserId, ACCEPTANCE_TEXT);

    const beforeCommitments = await prisma.planCommitment.count({
      where: { childId: child.id },
    });
    const beforeSteps = await prisma.planStudyStep.count({
      where: { childId: child.id },
    });

    const gen = await extractRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/plan-extract`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: childCookie,
        },
        body: JSON.stringify({
          expectedRevision: entry.revision,
          requestId: "extract-req-1-abcdef",
        }),
      }),
      params(entry.id),
    );
    expect(gen.status).toBe(200);
    const genBody = (await gen.json()) as {
      batch: {
        id: string;
        sourceRevision: number;
        candidates: Array<{
          id: string;
          type: string;
          title: string;
          proposedDate: string | null;
          dateUncertain: boolean;
          sourceExcerpt: string;
        }>;
      };
    };

    expect(await prisma.planCommitment.count({ where: { childId: child.id } })).toBe(
      beforeCommitments,
    );
    expect(await prisma.planStudyStep.count({ where: { childId: child.id } })).toBe(
      beforeSteps,
    );

    const types = genBody.batch.candidates.map((c) => c.type).sort();
    expect(types).toEqual(["EXAM", "HOMEWORK", "STUDY_STEP"]);
    expect(
      genBody.batch.candidates.some((c) => /basket/i.test(c.title)),
    ).toBe(false);

    const exam = genBody.batch.candidates.find((c) => c.type === "EXAM")!;
    const prep = genBody.batch.candidates.find((c) => c.type === "STUDY_STEP")!;
    const hw = genBody.batch.candidates.find((c) => c.type === "HOMEWORK")!;
    expect(exam.proposedDate).toBe("2026-09-11");
    expect(prep.proposedDate).toBe("2026-09-10");
    expect(hw.proposedDate).toBeNull();
    expect(hw.dateUncertain).toBe(true);

    const apply = await applyRoute(
      request(
        `http://localhost:3000/api/child/journal/${entry.id}/plan-extract/apply`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: childCookie,
          },
          body: JSON.stringify({
            batchId: genBody.batch.id,
            applyRequestId: "apply-req-1-abcdef",
            expectedSourceRevision: genBody.batch.sourceRevision,
            selections: [
              {
                candidateId: exam.id,
                selected: true,
                title: exam.title,
                confirmedDate: "2026-09-11",
              },
              {
                candidateId: prep.id,
                selected: true,
                title: prep.title,
                plannedDate: "2026-09-10",
                relatedCandidateId: exam.id,
              },
              {
                candidateId: hw.id,
                selected: false,
              },
            ],
          }),
        },
      ),
      params(entry.id),
    );
    expect(apply.status).toBe(200);
    const applyBody = (await apply.json()) as {
      createdCommitmentIds: string[];
      createdStudyStepIds: string[];
    };
    expect(applyBody.createdCommitmentIds).toHaveLength(1);
    expect(applyBody.createdStudyStepIds).toHaveLength(1);

    const commitments = await prisma.planCommitment.findMany({
      where: { childId: child.id },
    });
    const steps = await prisma.planStudyStep.findMany({
      where: { childId: child.id },
    });
    expect(commitments).toHaveLength(1);
    expect(commitments[0]!.type).toBe("EXAM");
    expect(steps).toHaveLength(1);
    expect(steps[0]!.relatedCommitmentId).toBe(commitments[0]!.id);

    // Retry apply is idempotent
    const retry = await applyRoute(
      request(
        `http://localhost:3000/api/child/journal/${entry.id}/plan-extract/apply`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: childCookie,
          },
          body: JSON.stringify({
            batchId: genBody.batch.id,
            applyRequestId: "apply-req-1-abcdef",
            expectedSourceRevision: genBody.batch.sourceRevision,
            selections: [
              {
                candidateId: exam.id,
                selected: true,
                confirmedDate: "2026-09-11",
              },
              {
                candidateId: prep.id,
                selected: true,
                plannedDate: "2026-09-10",
                relatedCandidateId: exam.id,
              },
            ],
          }),
        },
      ),
      params(entry.id),
    );
    expect(retry.status).toBe(200);
    expect(await prisma.planCommitment.count({ where: { childId: child.id } })).toBe(1);
    expect(await prisma.planStudyStep.count({ where: { childId: child.id } })).toBe(1);

    const parentPlan = await getParentPlan(
      request("http://localhost:3000/api/parent/plan", {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
    );
    expect(parentPlan.status).toBe(200);
    const parentJson = JSON.stringify(await parentPlan.json());
    expect(parentJson).not.toMatch(/sourceExcerpt|PlanExtract|Basketbol|günlük/i);
    expect(parentJson).toContain(commitments[0]!.title);
  });

  it("requires confirmed dates for uncertain exams and rejects invalid excerpts", async () => {
    const { childCookie, childUserId } = await setupChild();
    const entry = await entryWithDiary(
      childUserId,
      "Galiba cuma sınav var. Bugün mutluyum.",
    );

    const gen = await extractRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/plan-extract`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: childCookie,
        },
        body: JSON.stringify({
          expectedRevision: entry.revision,
          requestId: "extract-uncertain-abcdef",
        }),
      }),
      params(entry.id),
    );
    const body = (await gen.json()) as {
      batch: {
        id: string;
        sourceRevision: number;
        candidates: Array<{
          id: string;
          dateUncertain: boolean;
          proposedDate: string | null;
        }>;
      };
    };
    expect(body.batch.candidates[0]!.dateUncertain).toBe(true);

    const missingDate = await applyRoute(
      request(
        `http://localhost:3000/api/child/journal/${entry.id}/plan-extract/apply`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: childCookie,
          },
          body: JSON.stringify({
            batchId: body.batch.id,
            applyRequestId: "apply-uncertain-abcdef",
            expectedSourceRevision: body.batch.sourceRevision,
            selections: [
              {
                candidateId: body.batch.candidates[0]!.id,
                selected: true,
              },
            ],
          }),
        },
      ),
      params(entry.id),
    );
    expect(missingDate.status).toBe(400);
  });

  it("stales suggestions on source edit and blocks apply after delete", async () => {
    const { childCookie, childUserId } = await setupChild();
    const entry = await entryWithDiary(childUserId, ACCEPTANCE_TEXT);

    const gen = await extractRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/plan-extract`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: childCookie,
        },
        body: JSON.stringify({
          expectedRevision: entry.revision,
          requestId: "extract-stale-abcdef01",
        }),
      }),
      params(entry.id),
    );
    const genBody = (await gen.json()) as {
      batch: {
        id: string;
        sourceRevision: number;
        candidates: Array<{ id: string; type: string }>;
      };
    };

    await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: ACCEPTANCE_TEXT + " Ek cümle.",
      expectedRevision: entry.revision,
      markSaved: true,
    });

    const latest = await getExtractRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/plan-extract`, {
        headers: { cookie: childCookie, origin: "http://localhost:3000" },
      }),
      params(entry.id),
    );
    const latestBody = (await latest.json()) as {
      batch: { isStale: boolean; status: string };
    };
    expect(latestBody.batch.isStale).toBe(true);

    const exam = genBody.batch.candidates.find((c) => c.type === "EXAM")!;
    const blocked = await applyRoute(
      request(
        `http://localhost:3000/api/child/journal/${entry.id}/plan-extract/apply`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: childCookie,
          },
          body: JSON.stringify({
            batchId: genBody.batch.id,
            applyRequestId: "apply-stale-abcdef01",
            expectedSourceRevision: genBody.batch.sourceRevision,
            selections: [
              {
                candidateId: exam.id,
                selected: true,
                confirmedDate: "2026-09-11",
              },
            ],
          }),
        },
      ),
      params(entry.id),
    );
    expect(blocked.status).toBe(409);

    // Mid-flight delete: create batch then delete entry then apply
    const entry2 = await entryWithDiary(childUserId, ACCEPTANCE_TEXT);
    const gen2 = await extractRoute(
      request(`http://localhost:3000/api/child/journal/${entry2.id}/plan-extract`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: childCookie,
        },
        body: JSON.stringify({
          expectedRevision: entry2.revision,
          requestId: "extract-delete-abcdef01",
        }),
      }),
      params(entry2.id),
    );
    const gen2Body = (await gen2.json()) as {
      batch: {
        id: string;
        sourceRevision: number;
        candidates: Array<{ id: string; type: string }>;
      };
    };
    await deleteJournalEntry({ childUserId, entryId: entry2.id });
    const afterDelete = await applyRoute(
      request(
        `http://localhost:3000/api/child/journal/${entry2.id}/plan-extract/apply`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: childCookie,
          },
          body: JSON.stringify({
            batchId: gen2Body.batch.id,
            applyRequestId: "apply-delete-abcdef01",
            expectedSourceRevision: gen2Body.batch.sourceRevision,
            selections: [
              {
                candidateId: gen2Body.batch.candidates[0]!.id,
                selected: true,
                confirmedDate: "2026-09-11",
              },
            ],
          }),
        },
      ),
      params(entry2.id),
    );
    expect([404, 410]).toContain(afterDelete.status);
    expect(await prisma.planExtractBatch.count({ where: { id: gen2Body.batch.id } })).toBe(
      0,
    );
  });

  it("offers duplicate review instead of silent merge", async () => {
    const { childCookie, childUserId, child } = await setupChild();
    await prisma.planCommitment.create({
      data: {
        childId: child.id,
        type: "EXAM",
        title: "Almanca kelime sınavı",
        eventDate: parseCalendarDate("2026-09-11"),
      },
    });
    const entry = await entryWithDiary(childUserId, ACCEPTANCE_TEXT);
    const gen = await extractRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/plan-extract`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: childCookie,
        },
        body: JSON.stringify({
          expectedRevision: entry.revision,
          requestId: "extract-dup-abcdef012",
        }),
      }),
      params(entry.id),
    );
    const genBody = (await gen.json()) as {
      batch: {
        id: string;
        sourceRevision: number;
        candidates: Array<{
          id: string;
          type: string;
          likelyDuplicates: unknown[];
        }>;
      };
    };
    const exam = genBody.batch.candidates.find((c) => c.type === "EXAM")!;
    expect(exam.likelyDuplicates.length).toBeGreaterThan(0);

    const needsDecision = await applyRoute(
      request(
        `http://localhost:3000/api/child/journal/${entry.id}/plan-extract/apply`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: childCookie,
          },
          body: JSON.stringify({
            batchId: genBody.batch.id,
            applyRequestId: "apply-dup-abcdef012",
            expectedSourceRevision: genBody.batch.sourceRevision,
            selections: [
              {
                candidateId: exam.id,
                selected: true,
                confirmedDate: "2026-09-11",
              },
            ],
          }),
        },
      ),
      params(entry.id),
    );
    expect(needsDecision.status).toBe(409);
    const needsBody = (await needsDecision.json()) as { code: string };
    expect(needsBody.code).toBe("DUPLICATE_REVIEW");

    const skip = await applyRoute(
      request(
        `http://localhost:3000/api/child/journal/${entry.id}/plan-extract/apply`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: childCookie,
          },
          body: JSON.stringify({
            batchId: genBody.batch.id,
            applyRequestId: "apply-dup-skip-abcdef",
            expectedSourceRevision: genBody.batch.sourceRevision,
            selections: [
              {
                candidateId: exam.id,
                selected: true,
                confirmedDate: "2026-09-11",
                duplicateDecision: "skip",
              },
            ],
          }),
        },
      ),
      params(entry.id),
    );
    expect(skip.status).toBe(200);
    expect(await prisma.planCommitment.count({ where: { childId: child.id } })).toBe(1);
  });

  it("is retry-safe on extract requestId", async () => {
    const { childCookie, childUserId } = await setupChild();
    const entry = await entryWithDiary(childUserId, ACCEPTANCE_TEXT);
    const body = {
      expectedRevision: entry.revision,
      requestId: "extract-idem-abcdef0123",
    };
    const a = await extractRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/plan-extract`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: childCookie,
        },
        body: JSON.stringify(body),
      }),
      params(entry.id),
    );
    const b = await extractRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/plan-extract`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: childCookie,
        },
        body: JSON.stringify(body),
      }),
      params(entry.id),
    );
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const aJson = (await a.json()) as { batch: { id: string } };
    const bJson = (await b.json()) as { batch: { id: string } };
    expect(aJson.batch.id).toBe(bJson.batch.id);
    expect(await prisma.planExtractBatch.count({ where: { entryId: entry.id } })).toBe(
      1,
    );
  });
});
