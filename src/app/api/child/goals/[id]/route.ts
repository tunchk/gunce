import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  attachStepToGoal,
  deleteGoal,
  detachStepFromGoal,
  getGoalDetail,
  GOAL_STATUSES,
  setGoalStatus,
  updateGoal,
  type GoalLifecycleStatus,
} from "@/lib/goal";
import { createStudyStep, PlanError } from "@/lib/plan";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/session";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

type Ctx = { params: Promise<{ id: string }> };

async function requireChild(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) {
    return {
      error: NextResponse.json(
        { error: "Kimlik doğrulama gerekli." },
        { status: 401, headers: NO_STORE },
      ),
    };
  }
  if (role !== "CHILD") {
    return {
      error: NextResponse.json(
        { error: "Yalnızca çocuk oturumu." },
        { status: 403, headers: NO_STORE },
      ),
    };
  }
  return { session };
}

function mapError(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE });
  }
  if (error instanceof PlanError) {
    const status =
      error.code === "NOT_FOUND" || error.code === "GONE"
        ? 404
        : error.code === "CONFLICT" || error.code === "DEADLINE_WARNING"
          ? 409
          : 400;
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status, headers: NO_STORE },
    );
  }
  console.error("goal detail api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;
  try {
    const goal = await getGoalDetail(authz.session!.user.id, id);
    return NextResponse.json({ goal }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(`goal-patch:${ip}`, 120, 60_000);
  if (!limited.allowed) {
    return NextResponse.json({ error: "Çok fazla deneme." }, { status: 429, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400, headers: NO_STORE });
  }

  try {
    if (body.op === "update") {
      if (typeof body.expectedRevision !== "number") {
        return NextResponse.json(
          { error: "expectedRevision gerekli." },
          { status: 400, headers: NO_STORE },
        );
      }
      const goal = await updateGoal({
        childUserId: authz.session!.user.id,
        id,
        expectedRevision: body.expectedRevision,
        title: typeof body.title === "string" ? body.title : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
        targetDate: body.targetDate as string | null | undefined,
      });
      return NextResponse.json({ goal }, { headers: NO_STORE });
    }

    if (body.op === "set_status") {
      if (typeof body.expectedRevision !== "number") {
        return NextResponse.json(
          { error: "expectedRevision gerekli." },
          { status: 400, headers: NO_STORE },
        );
      }
      const status = body.status as GoalLifecycleStatus;
      if (!GOAL_STATUSES.includes(status)) {
        return NextResponse.json(
          { error: "status ACTIVE, ACHIEVED veya ARCHIVED olmalı." },
          { status: 400, headers: NO_STORE },
        );
      }
      const goal = await setGoalStatus({
        childUserId: authz.session!.user.id,
        id,
        expectedRevision: body.expectedRevision,
        status,
      });
      return NextResponse.json({ goal }, { headers: NO_STORE });
    }

    if (body.op === "add_step") {
      const studyStep = await createStudyStep({
        childUserId: authz.session!.user.id,
        title: String(body.title ?? ""),
        subject: typeof body.subject === "string" ? body.subject : "",
        plannedDate: (body.plannedDate as string | null | undefined) ?? null,
        estimatedMinutes:
          body.estimatedMinutes === null || body.estimatedMinutes === undefined
            ? null
            : Number(body.estimatedMinutes),
        relatedCommitmentId:
          typeof body.relatedCommitmentId === "string" ? body.relatedCommitmentId : null,
        relatedGoalId: id,
        allowAfterDeadline: body.allowAfterDeadline === true,
        clientRequestId:
          typeof body.clientRequestId === "string" ? body.clientRequestId : null,
      });
      const goal = await getGoalDetail(authz.session!.user.id, id);
      return NextResponse.json({ studyStep, goal }, { headers: NO_STORE });
    }

    if (body.op === "attach_step") {
      if (typeof body.studyStepId !== "string" || typeof body.expectedStepRevision !== "number") {
        return NextResponse.json(
          { error: "studyStepId ve expectedStepRevision gerekli." },
          { status: 400, headers: NO_STORE },
        );
      }
      const studyStep = await attachStepToGoal({
        childUserId: authz.session!.user.id,
        goalId: id,
        studyStepId: body.studyStepId,
        expectedStepRevision: body.expectedStepRevision,
        allowMove: body.allowMove === true,
      });
      const goal = await getGoalDetail(authz.session!.user.id, id);
      return NextResponse.json({ studyStep, goal }, { headers: NO_STORE });
    }

    if (body.op === "detach_step") {
      if (typeof body.studyStepId !== "string" || typeof body.expectedStepRevision !== "number") {
        return NextResponse.json(
          { error: "studyStepId ve expectedStepRevision gerekli." },
          { status: 400, headers: NO_STORE },
        );
      }
      const studyStep = await detachStepFromGoal({
        childUserId: authz.session!.user.id,
        goalId: id,
        studyStepId: body.studyStepId,
        expectedStepRevision: body.expectedStepRevision,
      });
      const goal = await getGoalDetail(authz.session!.user.id, id);
      return NextResponse.json({ studyStep, goal }, { headers: NO_STORE });
    }

    return NextResponse.json({ error: "Bilinmeyen işlem." }, { status: 400, headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;
  try {
    await deleteGoal({ childUserId: authz.session!.user.id, id });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
