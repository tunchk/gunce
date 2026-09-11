import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  applyPlanExtractBatch,
  PlanExtractError,
  type ApplySelection,
} from "@/lib/plan-extract";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/session";

export const runtime = "nodejs";

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

export async function POST(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id: entryId } = await ctx.params;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(
    `plan-extract-apply:${authz.session!.user.id}:${ip}`,
    20,
    60_000,
  );
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Çok fazla deneme. Biraz bekle." },
      { status: 429, headers: NO_STORE },
    );
  }

  let body: {
    batchId?: string;
    applyRequestId?: string;
    expectedSourceRevision?: number;
    selections?: ApplySelection[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Geçersiz istek." },
      { status: 400, headers: NO_STORE },
    );
  }

  if (typeof body.batchId !== "string" || !body.batchId.trim()) {
    return NextResponse.json(
      { error: "batchId gerekli." },
      { status: 400, headers: NO_STORE },
    );
  }
  if (typeof body.expectedSourceRevision !== "number") {
    return NextResponse.json(
      { error: "expectedSourceRevision gerekli." },
      { status: 400, headers: NO_STORE },
    );
  }
  if (!Array.isArray(body.selections)) {
    return NextResponse.json(
      { error: "selections gerekli." },
      { status: 400, headers: NO_STORE },
    );
  }

  const applyRequestId =
    typeof body.applyRequestId === "string" && body.applyRequestId.trim().length >= 8
      ? body.applyRequestId.trim().slice(0, 80)
      : randomUUID();

  try {
    const result = await applyPlanExtractBatch({
      childUserId: authz.session!.user.id,
      batchId: body.batchId.trim(),
      applyRequestId,
      expectedSourceRevision: body.expectedSourceRevision,
      selections: body.selections,
    });

    // Ensure batch belongs to this entry (defense in depth).
    if (result.batch.entryId !== entryId) {
      return NextResponse.json(
        { error: "Öneri bu yazıya ait değil.", code: "CONFLICT" },
        { status: 409, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      {
        batch: result.batch,
        createdCommitmentIds: result.createdCommitmentIds,
        createdStudyStepIds: result.createdStudyStepIds,
        skippedCandidateIds: result.skippedCandidateIds,
        applyRequestId,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 403, headers: NO_STORE },
      );
    }
    if (error instanceof PlanExtractError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "GONE"
            ? 410
            : error.code === "CONFLICT" || error.code === "DUPLICATE_REVIEW"
              ? 409
              : 400;
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details ?? undefined,
        },
        { status, headers: NO_STORE },
      );
    }
    console.error("plan-extract apply error");
    return NextResponse.json(
      { error: "Planına eklenemedi." },
      { status: 500, headers: NO_STORE },
    );
  }
}
