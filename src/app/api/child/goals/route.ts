import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createGoal,
  listGoalsForChild,
  listUnlinkedStudySteps,
} from "@/lib/goal";
import { PlanError } from "@/lib/plan";
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
        : error.code === "CONFLICT" || error.code === "DEADLINE_WARNING"
          ? 409
          : 400;
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status, headers: NO_STORE },
    );
  }
  console.error("goal api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const unlinked = new URL(request.url).searchParams.get("unlinkedSteps") === "1";
  try {
    if (unlinked) {
      const studySteps = await listUnlinkedStudySteps(authz.session!.user.id);
      return NextResponse.json({ studySteps }, { headers: NO_STORE });
    }
    const goals = await listGoalsForChild(authz.session!.user.id);
    return NextResponse.json({ goals }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(`goal-create:${ip}`, 40, 60_000);
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
    const goal = await createGoal({
      childUserId: authz.session!.user.id,
      title: String(body.title ?? ""),
      description: typeof body.description === "string" ? body.description : "",
      targetDate: (body.targetDate as string | null | undefined) ?? null,
      clientRequestId:
        typeof body.clientRequestId === "string" ? body.clientRequestId : null,
    });
    return NextResponse.json({ goal }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
