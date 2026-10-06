import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { retryGuardianAiForCurrentRevision } from "@/lib/journal-ai";
import { getParentVisibleEntry, JournalError } from "@/lib/journal";
import { AuthorizationError } from "@/lib/session";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

type Ctx = { params: Promise<{ entryId: string }> };

async function requireParent(request: NextRequest) {
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
  if (role !== "PARENT") {
    return {
      error: NextResponse.json(
        { error: "Yalnızca veli oturumu." },
        { status: 403, headers: NO_STORE },
      ),
    };
  }
  return { session };
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const authz = await requireParent(request);
  if (authz.error) return authz.error;
  const { entryId } = await ctx.params;
  try {
    const entry = await getParentVisibleEntry(authz.session.user.id, entryId);
    return NextResponse.json({ entry }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 403, headers: NO_STORE },
      );
    }
    if (error instanceof JournalError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : 400, headers: NO_STORE },
      );
    }
    console.error("parent journal detail api error");
    return NextResponse.json(
      { error: "İşlem başarısız." },
      { status: 500, headers: NO_STORE },
    );
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const authz = await requireParent(request);
  if (authz.error) return authz.error;
  const { entryId } = await ctx.params;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(
    `parent-journal-ai-retry:${authz.session.user.id}:${ip}`,
    10,
    60_000,
  );
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Çok fazla deneme." },
      { status: 429, headers: NO_STORE },
    );
  }

  let body: { op?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Geçersiz istek." },
      { status: 400, headers: NO_STORE },
    );
  }

  if (body.op !== "retry_ai") {
    return NextResponse.json(
      { error: "Geçersiz işlem." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    await getParentVisibleEntry(authz.session.user.id, entryId);
    const retried = await retryGuardianAiForCurrentRevision(entryId);
    if (!retried.ok) {
      return NextResponse.json(
        { error: "Bu kayıt için yeniden deneme yok." },
        { status: 400, headers: NO_STORE },
      );
    }
    const entry = await getParentVisibleEntry(authz.session.user.id, entryId);
    return NextResponse.json({ entry }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof JournalError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : 400, headers: NO_STORE },
      );
    }
    console.error("parent journal retry api error");
    return NextResponse.json(
      { error: "İşlem başarısız." },
      { status: 500, headers: NO_STORE },
    );
  }
}
