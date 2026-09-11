import { describe, expect, it } from "vitest";
import { GET as getPlan, POST as createPlan } from "@/app/api/child/plan/route";
import {
  DELETE as deleteCommitment,
  PATCH as patchCommitment,
} from "@/app/api/child/plan/commitment/[id]/route";
import { PATCH as patchStep } from "@/app/api/child/plan/step/[id]/route";
import {
  GET as parentPlanGet,
  POST as parentPlanPost,
  PATCH as parentPlanPatch,
  DELETE as parentPlanDelete,
} from "@/app/api/parent/plan/route";
import { createJournalEntry } from "@/lib/journal";
import {
  addCalendarDays,
  calendarDateInTimeZone,
  startOfWeekMonday,
} from "@/lib/plan-dates";
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

async function setupFamily(emailPrefix: string) {
  const parent = await createParent({ email: `${emailPrefix}_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childRow = await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } });
  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const today = calendarDateInTimeZone(childRow.timeZone);
  return {
    parent,
    child,
    childCookie,
    parentCookie,
    childUserId: childRow.userId!,
    timeZone: childRow.timeZone,
    today,
    friday: addCalendarDays(startOfWeekMonday(today), 4),
    wednesday: addCalendarDays(startOfWeekMonday(today), 2),
    thursday: addCalendarDays(startOfWeekMonday(today), 3),
  };
}

describe("Weekly planning (Milestone 4)", () => {
  it("denies unauthenticated and cross-child access", async () => {
    const a = await setupFamily("plan_a");
    const createRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "commitment",
          type: "EXAM",
          title: "Almanca kelime sınavı",
          eventDate: a.friday,
          clientRequestId: `exam-${Date.now()}`,
        }),
      }),
    );
    expect(createRes.status).toBe(200);
    const { commitment } = (await createRes.json()) as {
      commitment: { id: string };
    };

    const unauth = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          kind: "commitment",
          type: "HOMEWORK",
          title: "x",
          dateUnknown: true,
        }),
      }),
    );
    expect(unauth.status).toBe(401);

    const b = await setupFamily("plan_b");
    const cross = await patchCommitment(
      request(`http://localhost:3000/api/child/plan/commitment/${commitment.id}`, {
        method: "PATCH",
        headers: {
          cookie: b.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_completed",
          expectedRevision: 1,
          completed: true,
        }),
      }),
      params(commitment.id),
    );
    expect(cross.status).toBe(404);
  });

  it("denies cross-family parent reads and parent writes", async () => {
    const a = await setupFamily("plan_parent_a");
    await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "commitment",
          type: "EXAM",
          title: "Gizli sınav",
          eventDate: a.friday,
          clientRequestId: `secret-${Date.now()}`,
        }),
      }),
    );

    const other = await setupFamily("plan_parent_b");
    const otherParentView = await parentPlanGet(
      request("http://localhost:3000/api/parent/plan", {
        headers: { cookie: other.parentCookie, origin: "http://localhost:3000" },
      }),
    );
    expect(otherParentView.status).toBe(200);
    const otherBody = (await otherParentView.json()) as {
      children: { days: { commitments: { title: string }[] }[] }[];
    };
    const titles = otherBody.children.flatMap((c) =>
      c.days.flatMap((d) => d.commitments.map((x) => x.title)),
    );
    expect(titles).not.toContain("Gizli sınav");

    for (const method of [parentPlanPost, parentPlanPatch, parentPlanDelete]) {
      const res = await method();
      expect(res.status).toBe(403);
    }
  });

  it("rejects linking another child's commitment", async () => {
    const a = await setupFamily("link_a");
    const createRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "commitment",
          type: "EXAM",
          title: "A sınavı",
          eventDate: a.friday,
          clientRequestId: `link-exam-${Date.now()}`,
        }),
      }),
    );
    const { commitment } = (await createRes.json()) as { commitment: { id: string } };

    const b = await setupFamily("link_b");
    const step = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: b.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "Çalma denemesi",
          relatedCommitmentId: commitment.id,
          plannedDate: b.wednesday,
        }),
      }),
    );
    expect(step.status).toBe(404);
  });

  it("rescheduling a step does not change the exam deadline", async () => {
    const a = await setupFamily("resched");
    const examRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "commitment",
          type: "EXAM",
          title: "Almanca kelime sınavı",
          eventDate: a.friday,
          clientRequestId: `resched-exam-${Date.now()}`,
        }),
      }),
    );
    const { commitment } = (await examRes.json()) as {
      commitment: { id: string; eventDate: string; revision: number };
    };

    const stepRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "Kendimi dene",
          plannedDate: a.thursday,
          estimatedMinutes: 15,
          relatedCommitmentId: commitment.id,
          clientRequestId: `resched-step-${Date.now()}`,
        }),
      }),
    );
    const { studyStep } = (await stepRes.json()) as {
      studyStep: { id: string; revision: number };
    };

    const moved = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "reschedule",
          expectedRevision: studyStep.revision,
          plannedDate: a.friday,
        }),
      }),
      params(studyStep.id),
    );
    expect(moved.status).toBe(200);
    const movedBody = (await moved.json()) as {
      studyStep: { plannedDate: string; revision: number };
    };
    expect(movedBody.studyStep.plannedDate).toBe(a.friday);

    const examRow = await prisma.planCommitment.findUniqueOrThrow({
      where: { id: commitment.id },
    });
    expect(examRow.eventDate!.toISOString().slice(0, 10)).toBe(a.friday);
    expect(examRow.revision).toBe(commitment.revision);
    expect(examRow.completedAt).toBeNull();

    const completeClean = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: movedBody.studyStep.revision,
          status: "DONE",
        }),
      }),
      params(studyStep.id),
    );
    expect(completeClean.status).toBe(200);
    const examStill = await prisma.planCommitment.findUniqueOrThrow({
      where: { id: commitment.id },
    });
    expect(examStill.completedAt).toBeNull();
  });

  it("completion and undo are retry-safe with explicit desired state", async () => {
    const a = await setupFamily("complete");
    const stepRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "5 kelimeyi tekrar et",
          plannedDate: a.today,
          estimatedMinutes: 10,
          clientRequestId: `complete-step-${Date.now()}`,
        }),
      }),
    );
    const { studyStep } = (await stepRes.json()) as {
      studyStep: { id: string; revision: number; status: string };
    };
    expect(studyStep.status).toBe("TODO");

    const first = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: studyStep.revision,
          status: "DONE",
        }),
      }),
      params(studyStep.id),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      studyStep: { revision: number; status: string };
    };
    expect(firstBody.studyStep.status).toBe("DONE");

    const retry = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: studyStep.revision,
          status: "DONE",
        }),
      }),
      params(studyStep.id),
    );
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as {
      studyStep: { revision: number; status: string };
    };
    expect(retryBody.studyStep.revision).toBe(firstBody.studyStep.revision);
    expect(retryBody.studyStep.status).toBe("DONE");

    const undo = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: firstBody.studyStep.revision,
          status: "TODO",
        }),
      }),
      params(studyStep.id),
    );
    expect(undo.status).toBe(200);
    const undoBody = (await undo.json()) as {
      studyStep: { status: string };
    };
    expect(undoBody.studyStep.status).toBe("TODO");
  });

  it("duplicate creation submissions return the same item", async () => {
    const a = await setupFamily("dup");
    const clientRequestId = `dup-${Date.now()}`;
    const body = {
      kind: "commitment",
      type: "HOMEWORK",
      title: "Matematik ödevi",
      dateUnknown: true,
      clientRequestId,
    };
    const first = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(body),
      }),
    );
    const second = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(body),
      }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a1 = (await first.json()) as { commitment: { id: string } };
    const a2 = (await second.json()) as { commitment: { id: string } };
    expect(a1.commitment.id).toBe(a2.commitment.id);
    const count = await prisma.planCommitment.count({
      where: { childId: a.child.id, title: "Matematik ödevi" },
    });
    expect(count).toBe(1);
  });

  it("supports both linked-item deletion options atomically", async () => {
    const a = await setupFamily("del");
    async function makeExamWithStep(suffix: string) {
      const examRes = await createPlan(
        request("http://localhost:3000/api/child/plan", {
          method: "POST",
          headers: {
            cookie: a.childCookie,
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({
            kind: "commitment",
            type: "EXAM",
            title: `Sınav ${suffix}`,
            eventDate: a.friday,
            clientRequestId: `del-exam-${suffix}-${Date.now()}`,
          }),
        }),
      );
      const { commitment } = (await examRes.json()) as { commitment: { id: string } };
      const stepRes = await createPlan(
        request("http://localhost:3000/api/child/plan", {
          method: "POST",
          headers: {
            cookie: a.childCookie,
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({
            kind: "study_step",
            title: `Adım ${suffix}`,
            plannedDate: a.wednesday,
            relatedCommitmentId: commitment.id,
            clientRequestId: `del-step-${suffix}-${Date.now()}`,
          }),
        }),
      );
      const { studyStep } = (await stepRes.json()) as { studyStep: { id: string } };
      return { commitment, studyStep };
    }

    const keep = await makeExamWithStep("keep");
    const keepDel = await deleteCommitment(
      request(`http://localhost:3000/api/child/plan/commitment/${keep.commitment.id}`, {
        method: "DELETE",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ linkedSteps: "keep" }),
      }),
      params(keep.commitment.id),
    );
    expect(keepDel.status).toBe(200);
    expect(
      await prisma.planCommitment.findUnique({ where: { id: keep.commitment.id } }),
    ).toBeNull();
    const keptStep = await prisma.planStudyStep.findUniqueOrThrow({
      where: { id: keep.studyStep.id },
    });
    expect(keptStep.relatedCommitmentId).toBeNull();

    const gone = await makeExamWithStep("gone");
    const goneDel = await deleteCommitment(
      request(`http://localhost:3000/api/child/plan/commitment/${gone.commitment.id}`, {
        method: "DELETE",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ linkedSteps: "delete" }),
      }),
      params(gone.commitment.id),
    );
    expect(goneDel.status).toBe(200);
    expect(
      await prisma.planStudyStep.findUnique({ where: { id: gone.studyStep.id } }),
    ).toBeNull();
  });

  it("keeps unscheduled and missed steps accessible", async () => {
    const a = await setupFamily("access");
    const unscheduledRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "Plansız adım",
          plannedDate: null,
          clientRequestId: `unsched-${Date.now()}`,
        }),
      }),
    );
    expect(unscheduledRes.status).toBe(200);

    const missedDate = addCalendarDays(a.today, -2);
    const missedRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "Kaçırılan adım",
          plannedDate: missedDate,
          clientRequestId: `missed-${Date.now()}`,
        }),
      }),
    );
    expect(missedRes.status).toBe(200);

    const weekGet = await getPlan(
      request("http://localhost:3000/api/child/plan", {
        headers: { cookie: a.childCookie, origin: "http://localhost:3000" },
      }),
    );
    expect(weekGet.status).toBe(200);
    const body = (await weekGet.json()) as {
      week: {
        unscheduled: { title: string }[];
        missed: { title: string }[];
      };
    };
    expect(body.week.unscheduled.some((s) => s.title === "Plansız adım")).toBe(true);
    expect(body.week.missed.some((s) => s.title === "Kaçırılan adım")).toBe(true);
  });

  it("handles date-only storage and week boundaries across months", async () => {
    const monday = "2026-01-26"; // late January
    expect(startOfWeekMonday("2026-02-01")).toBe(monday);
    expect(addCalendarDays(monday, 6)).toBe("2026-02-01");

    const a = await setupFamily("dates");
    const yearEdge = "2026-12-31";
    const createRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "commitment",
          type: "EXAM",
          title: "Yıl sonu sınavı",
          eventDate: yearEdge,
          clientRequestId: `edge-${Date.now()}`,
        }),
      }),
    );
    expect(createRes.status).toBe(200);
    const { commitment } = (await createRes.json()) as {
      commitment: { eventDate: string };
    };
    expect(commitment.eventDate).toBe(yearEdge);

    const weekStart = startOfWeekMonday(yearEdge);
    const weekGet = await getPlan(
      request(`http://localhost:3000/api/child/plan?weekStart=${weekStart}`, {
        headers: { cookie: a.childCookie, origin: "http://localhost:3000" },
      }),
    );
    const body = (await weekGet.json()) as {
      week: { days: { date: string; commitments: { title: string }[] }[] };
    };
    const day = body.week.days.find((d) => d.date === yearEdge);
    expect(day?.commitments.some((c) => c.title === "Yıl sonu sınavı")).toBe(true);
  });

  it("parent plan responses exclude private journal data", async () => {
    const a = await setupFamily("noj");
    await createJournalEntry({
      childUserId: a.childUserId,
      body: "GİZLİ_GÜNLÜK_METNİ_ASLA_GÖRÜNMESİN",
    });
    await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "commitment",
          type: "COURSE",
          title: "Yüzme",
          eventDate: a.friday,
          eventTimeLocal: "16:30",
          clientRequestId: `course-${Date.now()}`,
        }),
      }),
    );

    const parentView = await parentPlanGet(
      request("http://localhost:3000/api/parent/plan", {
        headers: { cookie: a.parentCookie, origin: "http://localhost:3000" },
      }),
    );
    expect(parentView.status).toBe(200);
    const text = await parentView.text();
    expect(text).not.toContain("GİZLİ_GÜNLÜK_METNİ_ASLA_GÖRÜNMESİN");
    expect(text).not.toContain("transcript");
    expect(text).not.toContain("journal");
    expect(text).toContain("Yüzme");
  });

  it("migrates completedAt semantics into status and preserves links/dates", async () => {
    const a = await setupFamily("migrate");
    const examRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "commitment",
          type: "EXAM",
          title: "Tarih sınavı",
          eventDate: a.friday,
          clientRequestId: `mig-exam-${Date.now()}`,
        }),
      }),
    );
    const { commitment } = (await examRes.json()) as { commitment: { id: string } };
    const openRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "Açık adım",
          plannedDate: a.wednesday,
          relatedCommitmentId: commitment.id,
          clientRequestId: `mig-open-${Date.now()}`,
        }),
      }),
    );
    const doneRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "Bitmiş adım",
          plannedDate: a.thursday,
          relatedCommitmentId: commitment.id,
          clientRequestId: `mig-done-${Date.now()}`,
        }),
      }),
    );
    const open = (await openRes.json()) as { studyStep: { id: string; status: string } };
    const done = (await doneRes.json()) as {
      studyStep: { id: string; revision: number; status: string };
    };
    expect(open.studyStep.status).toBe("TODO");
    await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${done.studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: done.studyStep.revision,
          status: "DONE",
        }),
      }),
      params(done.studyStep.id),
    );
    const rows = await prisma.planStudyStep.findMany({
      where: { childId: a.child.id },
      orderBy: { title: "asc" },
    });
    expect(rows.find((r) => r.title === "Açık adım")?.status).toBe("TODO");
    expect(rows.find((r) => r.title === "Bitmiş adım")?.status).toBe("DONE");
    expect(rows.every((r) => r.relatedCommitmentId === commitment.id)).toBe(true);
  });

  it("status changes preserve plannedDate and linked deadlines; reschedule preserves status", async () => {
    const a = await setupFamily("status_dates");
    const examRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "commitment",
          type: "EXAM",
          title: "Fen",
          eventDate: a.friday,
          clientRequestId: `st-exam-${Date.now()}`,
        }),
      }),
    );
    const { commitment } = (await examRes.json()) as {
      commitment: { id: string; eventDate: string };
    };
    const stepRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "Konu tekrarı",
          plannedDate: a.wednesday,
          estimatedMinutes: 20,
          relatedCommitmentId: commitment.id,
          clientRequestId: `st-step-${Date.now()}`,
        }),
      }),
    );
    const { studyStep } = (await stepRes.json()) as {
      studyStep: { id: string; revision: number; plannedDate: string };
    };

    const started = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: studyStep.revision,
          status: "IN_PROGRESS",
        }),
      }),
      params(studyStep.id),
    );
    const startedBody = (await started.json()) as {
      studyStep: {
        status: string;
        plannedDate: string;
        relatedDeadline: string | null;
        revision: number;
      };
    };
    expect(startedBody.studyStep.status).toBe("IN_PROGRESS");
    expect(startedBody.studyStep.plannedDate).toBe(a.wednesday);
    expect(startedBody.studyStep.relatedDeadline).toBe(commitment.eventDate);

    const exam = await prisma.planCommitment.findUniqueOrThrow({
      where: { id: commitment.id },
    });
    expect(exam.eventDate!.toISOString().slice(0, 10)).toBe(a.friday);

    const moved = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "reschedule",
          expectedRevision: startedBody.studyStep.revision,
          plannedDate: a.thursday,
        }),
      }),
      params(studyStep.id),
    );
    const movedBody = (await moved.json()) as {
      studyStep: { status: string; plannedDate: string };
    };
    expect(movedBody.studyStep.plannedDate).toBe(a.thursday);
    expect(movedBody.studyStep.status).toBe("IN_PROGRESS");
  });

  it("week and board share the same step records and next-step prefers IN_PROGRESS today", async () => {
    const a = await setupFamily("board_share");
    const todoRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "TODO bugün",
          plannedDate: a.today,
          estimatedMinutes: 5,
          clientRequestId: `todo-today-${Date.now()}`,
        }),
      }),
    );
    const progRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "Devam eden bugün",
          plannedDate: a.today,
          estimatedMinutes: 30,
          clientRequestId: `prog-today-${Date.now()}`,
        }),
      }),
    );
    const prog = (await progRes.json()) as {
      studyStep: { id: string; revision: number };
    };
    await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${prog.studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: prog.studyStep.revision,
          status: "IN_PROGRESS",
        }),
      }),
      params(prog.studyStep.id),
    );

    const weekGet = await getPlan(
      request("http://localhost:3000/api/child/plan", {
        headers: { cookie: a.childCookie, origin: "http://localhost:3000" },
      }),
    );
    const body = (await weekGet.json()) as {
      week: {
        days: { studySteps: { id: string; title: string; status: string }[] }[];
      };
    };
    const all = body.week.days.flatMap((d) => d.studySteps);
    expect(all.some((s) => s.title === "TODO bugün" && s.status === "TODO")).toBe(true);
    expect(all.some((s) => s.title === "Devam eden bugün" && s.status === "IN_PROGRESS")).toBe(
      true,
    );

    const { getNextStudyStepForToday } = await import("@/lib/plan");
    const next = await getNextStudyStepForToday(a.childUserId);
    expect(next?.title).toBe("Devam eden bugün");
    expect(next?.status).toBe("IN_PROGRESS");
    void todoRes;
  });

  it("moving a DONE step keeps DONE and parent writes stay denied", async () => {
    const a = await setupFamily("done_move");
    const stepRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "Bitmiş taşı",
          plannedDate: a.wednesday,
          clientRequestId: `done-move-${Date.now()}`,
        }),
      }),
    );
    const { studyStep } = (await stepRes.json()) as {
      studyStep: { id: string; revision: number };
    };
    const done = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: studyStep.revision,
          status: "DONE",
        }),
      }),
      params(studyStep.id),
    );
    const doneBody = (await done.json()) as { studyStep: { revision: number } };
    const moved = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "reschedule",
          expectedRevision: doneBody.studyStep.revision,
          plannedDate: a.friday,
        }),
      }),
      params(studyStep.id),
    );
    const movedBody = (await moved.json()) as {
      studyStep: { status: string; plannedDate: string };
    };
    expect(movedBody.studyStep.status).toBe("DONE");
    expect(movedBody.studyStep.plannedDate).toBe(a.friday);

    expect((await parentPlanPost()).status).toBe(403);
  });

  it("completedAt is metadata set on DONE, preserved on idempotent DONE and reschedule, cleared when leaving DONE", async () => {
    const a = await setupFamily("completed_at_meta");
    const stepRes = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "Zaman damgası",
          plannedDate: a.wednesday,
          clientRequestId: `ts-meta-${Date.now()}`,
        }),
      }),
    );
    const { studyStep } = (await stepRes.json()) as {
      studyStep: { id: string; revision: number; status: string; completedAt: string | null };
    };
    expect(studyStep.status).toBe("TODO");
    expect(studyStep.completedAt).toBeNull();

    const toProgress = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: studyStep.revision,
          status: "IN_PROGRESS",
        }),
      }),
      params(studyStep.id),
    );
    const progressBody = (await toProgress.json()) as {
      studyStep: { revision: number; status: string; completedAt: string | null };
    };
    expect(progressBody.studyStep.status).toBe("IN_PROGRESS");
    expect(progressBody.studyStep.completedAt).toBeNull();

    const toDone = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: progressBody.studyStep.revision,
          status: "DONE",
        }),
      }),
      params(studyStep.id),
    );
    const doneBody = (await toDone.json()) as {
      studyStep: {
        revision: number;
        status: string;
        completedAt: string | null;
        plannedDate: string;
      };
    };
    expect(doneBody.studyStep.status).toBe("DONE");
    expect(doneBody.studyStep.completedAt).toBeTruthy();
    const firstCompletedAt = doneBody.studyStep.completedAt!;

    const idempotentDone = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: studyStep.revision,
          status: "DONE",
        }),
      }),
      params(studyStep.id),
    );
    expect(idempotentDone.status).toBe(200);
    const idempotentBody = (await idempotentDone.json()) as {
      studyStep: { revision: number; status: string; completedAt: string | null };
    };
    expect(idempotentBody.studyStep.status).toBe("DONE");
    expect(idempotentBody.studyStep.completedAt).toBe(firstCompletedAt);
    expect(idempotentBody.studyStep.revision).toBe(doneBody.studyStep.revision);

    const rescheduled = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "reschedule",
          expectedRevision: doneBody.studyStep.revision,
          plannedDate: a.friday,
        }),
      }),
      params(studyStep.id),
    );
    const movedBody = (await rescheduled.json()) as {
      studyStep: {
        revision: number;
        status: string;
        completedAt: string | null;
        plannedDate: string;
      };
    };
    expect(movedBody.studyStep.status).toBe("DONE");
    expect(movedBody.studyStep.plannedDate).toBe(a.friday);
    expect(movedBody.studyStep.completedAt).toBe(firstCompletedAt);

    const reopen = await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: movedBody.studyStep.revision,
          status: "TODO",
        }),
      }),
      params(studyStep.id),
    );
    const reopenBody = (await reopen.json()) as {
      studyStep: { status: string; completedAt: string | null };
    };
    expect(reopenBody.studyStep.status).toBe("TODO");
    expect(reopenBody.studyStep.completedAt).toBeNull();
  });
});
