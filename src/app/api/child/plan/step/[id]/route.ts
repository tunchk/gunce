import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  deleteStudyStep,
  getStudyStep,
  PlanError,
  rescheduleStudyStep,
  setStudyStepStatus,
  STUDY_STEP_STATUSES,
  updateStudyStep,
  type StudyStepStatus,
} from "@/lib/plan";
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
  console.error("plan step api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;
  try {
    const studyStep = await getStudyStep(authz.session!.user.id, id);
    return NextResponse.json({ studyStep }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(`plan-step-patch:${ip}`, 120, 60_000);
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
      const studyStep = await updateStudyStep({
        childUserId: authz.session!.user.id,
        id,
        expectedRevision: body.expectedRevision,
        title: typeof body.title === "string" ? body.title : undefined,
        subject: typeof body.subject === "string" ? body.subject : undefined,
        plannedDate: body.plannedDate as string | null | undefined,
        estimatedMinutes:
          body.estimatedMinutes === undefined
            ? undefined
            : body.estimatedMinutes === null
              ? null
              : Number(body.estimatedMinutes),
        reminderLocalTime:
          body.reminderLocalTime === undefined
            ? undefined
            : body.reminderLocalTime === null
              ? null
              : String(body.reminderLocalTime),
        relatedCommitmentId: body.relatedCommitmentId as string | null | undefined,
        allowAfterDeadline: body.allowAfterDeadline === true,
      });
      return NextResponse.json({ studyStep }, { headers: NO_STORE });
    }

    if (body.op === "reschedule") {
      if (typeof body.expectedRevision !== "number") {
        return NextResponse.json(
          { error: "expectedRevision gerekli." },
          { status: 400, headers: NO_STORE },
        );
      }
      const studyStep = await rescheduleStudyStep({
        childUserId: authz.session!.user.id,
        id,
        expectedRevision: body.expectedRevision,
        plannedDate: (body.plannedDate as string | null) ?? null,
        allowAfterDeadline: body.allowAfterDeadline === true,
      });
      return NextResponse.json({ studyStep }, { headers: NO_STORE });
    }

    if (body.op === "set_status") {
      if (typeof body.expectedRevision !== "number") {
        return NextResponse.json(
          { error: "expectedRevision gerekli." },
          { status: 400, headers: NO_STORE },
        );
      }
      const status = body.status as StudyStepStatus;
      if (!STUDY_STEP_STATUSES.includes(status)) {
        return NextResponse.json(
          { error: "status TODO, IN_PROGRESS veya DONE olmalı." },
          { status: 400, headers: NO_STORE },
        );
      }
      const studyStep = await setStudyStepStatus({
        childUserId: authz.session!.user.id,
        id,
        expectedRevision: body.expectedRevision,
        status,
      });
      return NextResponse.json({ studyStep }, { headers: NO_STORE });
    }

    // Backward-compatible alias: completed true → DONE, false → TODO
    if (body.op === "set_completed") {
      if (typeof body.expectedRevision !== "number" || typeof body.completed !== "boolean") {
        return NextResponse.json(
          { error: "expectedRevision ve completed gerekli." },
          { status: 400, headers: NO_STORE },
        );
      }
      const studyStep = await setStudyStepStatus({
        childUserId: authz.session!.user.id,
        id,
        expectedRevision: body.expectedRevision,
        status: body.completed ? "DONE" : "TODO",
      });
      return NextResponse.json({ studyStep }, { headers: NO_STORE });
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
    await deleteStudyStep({ childUserId: authz.session!.user.id, id });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
