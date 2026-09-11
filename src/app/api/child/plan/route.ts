import { NextRequest, NextResponse } from "next/server";
import type { PlanCommitmentType } from "@prisma/client";
import { auth } from "@/lib/auth";
import {
  createCommitment,
  createStudyStep,
  getWeekPlanForChild,
  listCommitmentsForLinking,
  PlanError,
} from "@/lib/plan";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/session";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

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
        : error.code === "CONFLICT"
          ? 409
          : error.code === "DEADLINE_WARNING"
            ? 409
            : 400;
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status, headers: NO_STORE },
    );
  }
  console.error("plan api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;

  const weekStart = new URL(request.url).searchParams.get("weekStart") || undefined;
  const linkable = new URL(request.url).searchParams.get("linkable") === "1";

  try {
    if (linkable) {
      const commitments = await listCommitmentsForLinking(authz.session!.user.id);
      return NextResponse.json({ commitments }, { headers: NO_STORE });
    }
    const week = await getWeekPlanForChild(authz.session!.user.id, weekStart || undefined);
    return NextResponse.json({ week }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(`plan-create:${ip}`, 60, 60_000);
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
    if (body.kind === "commitment") {
      const type = body.type as PlanCommitmentType;
      if (!["HOMEWORK", "EXAM", "COURSE"].includes(type)) {
        return NextResponse.json({ error: "Tür gerekli." }, { status: 400, headers: NO_STORE });
      }
      const commitment = await createCommitment({
        childUserId: authz.session!.user.id,
        type,
        title: String(body.title ?? ""),
        subject: typeof body.subject === "string" ? body.subject : "",
        dueDate: (body.dueDate as string | null | undefined) ?? null,
        eventDate: (body.eventDate as string | null | undefined) ?? null,
        eventTimeLocal: (body.eventTimeLocal as string | null | undefined) ?? null,
        dateUnknown: body.dateUnknown === true,
        clientRequestId:
          typeof body.clientRequestId === "string" ? body.clientRequestId : null,
      });
      return NextResponse.json({ commitment }, { headers: NO_STORE });
    }

    if (body.kind === "study_step") {
      const step = await createStudyStep({
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
        relatedGoalId: typeof body.relatedGoalId === "string" ? body.relatedGoalId : null,
        allowAfterDeadline: body.allowAfterDeadline === true,
        clientRequestId:
          typeof body.clientRequestId === "string" ? body.clientRequestId : null,
      });
      return NextResponse.json({ studyStep: step }, { headers: NO_STORE });
    }

    return NextResponse.json({ error: "Bilinmeyen tür." }, { status: 400, headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
