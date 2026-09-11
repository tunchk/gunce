import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  deleteCommitment,
  getCommitment,
  PlanError,
  setCommitmentCompletion,
  updateCommitment,
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
  console.error("plan commitment api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;
  try {
    const data = await getCommitment(authz.session!.user.id, id);
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(`plan-patch:${ip}`, 120, 60_000);
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
      const commitment = await updateCommitment({
        childUserId: authz.session!.user.id,
        id,
        expectedRevision: body.expectedRevision,
        title: typeof body.title === "string" ? body.title : undefined,
        subject: typeof body.subject === "string" ? body.subject : undefined,
        dueDate: (body.dueDate as string | null | undefined),
        eventDate: (body.eventDate as string | null | undefined),
        eventTimeLocal: (body.eventTimeLocal as string | null | undefined),
        dateUnknown: body.dateUnknown === true,
      });
      return NextResponse.json({ commitment }, { headers: NO_STORE });
    }

    if (body.op === "set_completed") {
      if (typeof body.expectedRevision !== "number" || typeof body.completed !== "boolean") {
        return NextResponse.json(
          { error: "expectedRevision ve completed gerekli." },
          { status: 400, headers: NO_STORE },
        );
      }
      const commitment = await setCommitmentCompletion({
        childUserId: authz.session!.user.id,
        id,
        expectedRevision: body.expectedRevision,
        completed: body.completed,
      });
      return NextResponse.json({ commitment }, { headers: NO_STORE });
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

  let linkedSteps: "keep" | "delete" = "keep";
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.linkedSteps === "delete") linkedSteps = "delete";
  } catch {
    /* keep default */
  }

  try {
    await deleteCommitment({
      childUserId: authz.session!.user.id,
      id,
      linkedSteps,
    });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
