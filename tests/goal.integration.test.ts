import { describe, expect, it } from "vitest";
import { GET as getGoals, POST as createGoalRoute } from "@/app/api/child/goals/route";
import {
  DELETE as deleteGoalRoute,
  GET as getGoalRoute,
  PATCH as patchGoalRoute,
} from "@/app/api/child/goals/[id]/route";
import {
  GET as parentGoalsGet,
  POST as parentGoalsPost,
  PATCH as parentGoalsPatch,
  DELETE as parentGoalsDelete,
} from "@/app/api/parent/goals/route";
import { GET as getPlan, POST as createPlan } from "@/app/api/child/plan/route";
import { PATCH as patchStep } from "@/app/api/child/plan/step/[id]/route";
import { createJournalEntry } from "@/lib/journal";
import { calendarDateInTimeZone } from "@/lib/plan-dates";
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

async function setupFamily(prefix: string) {
  const parent = await createParent({ email: `${prefix}_${Date.now()}@example.com` });
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
    today,
  };
}

describe("Long-term goals (Milestone 5)", () => {
  it("denies unauthenticated, cross-child, and cross-family access", async () => {
    const a = await setupFamily("goal_a");
    const create = await createGoalRoute(
      request("http://localhost:3000/api/child/goals", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          title: "Almancada 40 yeni kelime öğrenmek",
          clientRequestId: `g-a-${Date.now()}`,
        }),
      }),
    );
    expect(create.status).toBe(200);
    const { goal } = (await create.json()) as { goal: { id: string } };

    const unauth = await createGoalRoute(
      request("http://localhost:3000/api/child/goals", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ title: "x" }),
      }),
    );
    expect(unauth.status).toBe(401);

    const b = await setupFamily("goal_b");
    const cross = await getGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal.id}`, {
        headers: { cookie: b.childCookie, origin: "http://localhost:3000" },
      }),
      params(goal.id),
    );
    expect(cross.status).toBe(404);

    const otherParent = await parentGoalsGet(
      request("http://localhost:3000/api/parent/goals", {
        headers: { cookie: b.parentCookie, origin: "http://localhost:3000" },
      }),
    );
    const otherBody = (await otherParent.json()) as {
      children: { goals: { title: string }[] }[];
    };
    const titles = otherBody.children.flatMap((c) => c.goals.map((g) => g.title));
    expect(titles).not.toContain("Almancada 40 yeni kelime öğrenmek");
  });

  it("rejects parent writes and validates same-child relationships", async () => {
    const a = await setupFamily("goal_write");
    expect((await parentGoalsPost()).status).toBe(403);
    expect((await parentGoalsPatch()).status).toBe(403);
    expect((await parentGoalsDelete()).status).toBe(403);

    const goalRes = await createGoalRoute(
      request("http://localhost:3000/api/child/goals", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ title: "Hedef", clientRequestId: `gw-${Date.now()}` }),
      }),
    );
    const { goal } = (await goalRes.json()) as { goal: { id: string } };

    const b = await setupFamily("goal_write_b");
    const stepB = await createPlan(
      request("http://localhost:3000/api/child/plan", {
        method: "POST",
        headers: {
          cookie: b.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          kind: "study_step",
          title: "Başka çocuğun adımı",
          clientRequestId: `step-b-${Date.now()}`,
        }),
      }),
    );
    const { studyStep } = (await stepB.json()) as {
      studyStep: { id: string; revision: number };
    };

    const attachCross = await patchGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "attach_step",
          studyStepId: studyStep.id,
          expectedStepRevision: studyStep.revision,
        }),
      }),
      params(goal.id),
    );
    expect(attachCross.status).toBe(404);
  });

  it("uses the same PlanStudyStep records as week/board and tracks progress", async () => {
    const a = await setupFamily("goal_progress");
    const goalRes = await createGoalRoute(
      request("http://localhost:3000/api/child/goals", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          title: "Almancada 40 yeni kelime öğrenmek",
          clientRequestId: `gp-${Date.now()}`,
        }),
      }),
    );
    const { goal } = (await goalRes.json()) as { goal: { id: string; progress: { label: string } } };
    expect(goal.progress.label).toBe("Henüz adım yok");

    const add1 = await patchGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "add_step",
          title: "İlk 5 kelimeyi seç",
          plannedDate: a.today,
          estimatedMinutes: 10,
          clientRequestId: `s1-${Date.now()}`,
        }),
      }),
      params(goal.id),
    );
    expect(add1.status).toBe(200);
    const add1Body = (await add1.json()) as {
      studyStep: { id: string; revision: number; relatedGoalId: string };
      goal: { progress: { doneCount: number; totalCount: number; label: string } };
    };
    expect(add1Body.studyStep.relatedGoalId).toBe(goal.id);
    expect(add1Body.goal.progress.label).toBe("0 / 1 adım tamamlandı");

    const add2 = await patchGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "add_step",
          title: "Kelimeleri cümlede kullan",
          plannedDate: null,
          clientRequestId: `s2-${Date.now()}`,
        }),
      }),
      params(goal.id),
    );
    const add2Body = (await add2.json()) as {
      studyStep: { id: string };
      goal: { progress: { label: string }; status: string };
    };
    expect(add2Body.goal.progress.label).toBe("0 / 2 adım tamamlandı");

    const week = await getPlan(
      request("http://localhost:3000/api/child/plan", {
        headers: { cookie: a.childCookie, origin: "http://localhost:3000" },
      }),
    );
    const weekBody = (await week.json()) as {
      week: { days: { studySteps: { id: string }[] }[]; unscheduled: { id: string }[] };
    };
    const weekIds = [
      ...weekBody.week.days.flatMap((d) => d.studySteps.map((s) => s.id)),
      ...weekBody.week.unscheduled.map((s) => s.id),
    ];
    expect(weekIds).toContain(add1Body.studyStep.id);
    expect(weekIds).toContain(add2Body.studyStep.id);

    await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${add1Body.studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: add1Body.studyStep.revision,
          status: "DONE",
        }),
      }),
      params(add1Body.studyStep.id),
    );

    const detail = await getGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal.id}`, {
        headers: { cookie: a.childCookie, origin: "http://localhost:3000" },
      }),
      params(goal.id),
    );
    const detailBody = (await detail.json()) as {
      goal: { progress: { label: string }; status: string };
    };
    expect(detailBody.goal.progress.label).toBe("1 / 2 adım tamamlandı");
    expect(detailBody.goal.status).toBe("ACTIVE");
  });

  it("keeps goal lifecycle independent; archive and delete preserve steps", async () => {
    const a = await setupFamily("goal_life");
    const goalRes = await createGoalRoute(
      request("http://localhost:3000/api/child/goals", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ title: "Yaşam", clientRequestId: `gl-${Date.now()}` }),
      }),
    );
    const { goal } = (await goalRes.json()) as { goal: { id: string; revision: number } };

    const add = await patchGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "add_step",
          title: "Adım 1",
          plannedDate: a.today,
          clientRequestId: `gl-s-${Date.now()}`,
        }),
      }),
      params(goal.id),
    );
    const addBody = (await add.json()) as {
      studyStep: { id: string; revision: number; plannedDate: string };
      goal: { revision: number };
    };

    await patchStep(
      request(`http://localhost:3000/api/child/plan/step/${addBody.studyStep.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: addBody.studyStep.revision,
          status: "DONE",
        }),
      }),
      params(addBody.studyStep.id),
    );

    const detailAfterDone = await getGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal.id}`, {
        headers: { cookie: a.childCookie, origin: "http://localhost:3000" },
      }),
      params(goal.id),
    );
    const afterDone = (await detailAfterDone.json()) as {
      goal: { status: string; progress: { label: string }; revision: number };
    };
    expect(afterDone.goal.status).toBe("ACTIVE");
    expect(afterDone.goal.progress.label).toBe("1 / 1 adım tamamlandı");

    const achieve = await patchGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: afterDone.goal.revision,
          status: "ACHIEVED",
        }),
      }),
      params(goal.id),
    );
    const achieved = (await achieve.json()) as { goal: { status: string; revision: number } };
    expect(achieved.goal.status).toBe("ACHIEVED");

    const reopenGoal = await patchGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: achieved.goal.revision,
          status: "ACTIVE",
        }),
      }),
      params(goal.id),
    );
    const reopened = (await reopenGoal.json()) as { goal: { revision: number } };

    const archive = await patchGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: reopened.goal.revision,
          status: "ARCHIVED",
        }),
      }),
      params(goal.id),
    );
    expect(archive.status).toBe(200);
    const stepStill = await prisma.planStudyStep.findUniqueOrThrow({
      where: { id: addBody.studyStep.id },
    });
    expect(stepStill.plannedDate!.toISOString().slice(0, 10)).toBe(a.today);
    expect(stepStill.status).toBe("DONE");
    expect(stepStill.relatedGoalId).toBe(goal.id);

    const del = await deleteGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal.id}`, {
        method: "DELETE",
        headers: { cookie: a.childCookie, origin: "http://localhost:3000" },
      }),
      params(goal.id),
    );
    expect(del.status).toBe(200);
    expect(await prisma.planGoal.findUnique({ where: { id: goal.id } })).toBeNull();
    const stepAfter = await prisma.planStudyStep.findUniqueOrThrow({
      where: { id: addBody.studyStep.id },
    });
    expect(stepAfter.relatedGoalId).toBeNull();
    expect(stepAfter.status).toBe("DONE");
  });

  it("requires explicit move when attaching a step already linked to another goal", async () => {
    const a = await setupFamily("goal_move");
    const g1 = await createGoalRoute(
      request("http://localhost:3000/api/child/goals", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ title: "Hedef A", clientRequestId: `gm1-${Date.now()}` }),
      }),
    );
    const g2 = await createGoalRoute(
      request("http://localhost:3000/api/child/goals", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ title: "Hedef B", clientRequestId: `gm2-${Date.now()}` }),
      }),
    );
    const goal1 = (await g1.json()) as { goal: { id: string } };
    const goal2 = (await g2.json()) as { goal: { id: string } };

    const add = await patchGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal1.goal.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "add_step",
          title: "Ortak adım",
          clientRequestId: `gm-s-${Date.now()}`,
        }),
      }),
      params(goal1.goal.id),
    );
    const step = (await add.json()) as { studyStep: { id: string; revision: number } };

    const blocked = await patchGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal2.goal.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "attach_step",
          studyStepId: step.studyStep.id,
          expectedStepRevision: step.studyStep.revision,
        }),
      }),
      params(goal2.goal.id),
    );
    expect(blocked.status).toBe(409);
    const blockedBody = (await blocked.json()) as {
      details?: { code?: string };
    };
    expect(blockedBody.details?.code).toBe("GOAL_ALREADY_LINKED");

    const moved = await patchGoalRoute(
      request(`http://localhost:3000/api/child/goals/${goal2.goal.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "attach_step",
          studyStepId: step.studyStep.id,
          expectedStepRevision: step.studyStep.revision,
          allowMove: true,
        }),
      }),
      params(goal2.goal.id),
    );
    expect(moved.status).toBe(200);
    const row = await prisma.planStudyStep.findUniqueOrThrow({
      where: { id: step.studyStep.id },
    });
    expect(row.relatedGoalId).toBe(goal2.goal.id);
  });

  it("is retry-safe on create and rejects stale goal revisions", async () => {
    const a = await setupFamily("goal_retry");
    const clientRequestId = `gr-${Date.now()}`;
    const body = { title: "Tekrar", clientRequestId };
    const first = await createGoalRoute(
      request("http://localhost:3000/api/child/goals", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(body),
      }),
    );
    const second = await createGoalRoute(
      request("http://localhost:3000/api/child/goals", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(body),
      }),
    );
    const a1 = (await first.json()) as { goal: { id: string; revision: number } };
    const a2 = (await second.json()) as { goal: { id: string } };
    expect(a1.goal.id).toBe(a2.goal.id);

    const stale = await patchGoalRoute(
      request(`http://localhost:3000/api/child/goals/${a1.goal.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "update",
          expectedRevision: a1.goal.revision,
          title: "Yeni",
        }),
      }),
      params(a1.goal.id),
    );
    expect(stale.status).toBe(200);
    const again = await patchGoalRoute(
      request(`http://localhost:3000/api/child/goals/${a1.goal.id}`, {
        method: "PATCH",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "update",
          expectedRevision: a1.goal.revision,
          title: "Eski",
        }),
      }),
      params(a1.goal.id),
    );
    expect(again.status).toBe(409);
  });

  it("parent goal responses exclude private journal data", async () => {
    const a = await setupFamily("goal_noj");
    await createJournalEntry({
      childUserId: a.childUserId,
      body: "GİZLİ_HEDEF_GÜNLÜK",
    });
    await createGoalRoute(
      request("http://localhost:3000/api/child/goals", {
        method: "POST",
        headers: {
          cookie: a.childCookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          title: "Görünen hedef",
          description: "Kısa sonuç",
          clientRequestId: `gnj-${Date.now()}`,
        }),
      }),
    );
    const parentView = await parentGoalsGet(
      request("http://localhost:3000/api/parent/goals", {
        headers: { cookie: a.parentCookie, origin: "http://localhost:3000" },
      }),
    );
    const text = await parentView.text();
    expect(text).not.toContain("GİZLİ_HEDEF_GÜNLÜK");
    expect(text).not.toContain("transcript");
    expect(text).not.toContain("journal");
    expect(text).toContain("Görünen hedef");
  });
});
