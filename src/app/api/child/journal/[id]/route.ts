import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  deleteJournalEntry,
  getChildEntry,
  JournalError,
  publishShare,
  updateJournalBody,
  updateSharingDraft,
  withdrawShare,
} from "@/lib/journal";
import { AuthorizationError } from "@/lib/session";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

type Ctx = { params: Promise<{ id: string }> };

async function requireChild(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Kimlik doğrulama gerekli." }, { status: 401, headers: NO_STORE }) };
  }
  if (role !== "CHILD") {
    return { error: NextResponse.json({ error: "Yalnızca çocuk oturumu." }, { status: 403, headers: NO_STORE }) };
  }
  return { session };
}

function mapError(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE });
  }
  if (error instanceof JournalError) {
    const status =
      error.code === "NOT_FOUND" || error.code === "GONE"
        ? 404
        : error.code === "CONFLICT"
          ? 409
          : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status, headers: NO_STORE });
  }
  console.error("journal entry api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;

  try {
    const entry = await getChildEntry(authz.session!.user.id, id);
    return NextResponse.json({ entry }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(`journal-patch:${ip}`, 120, 60_000);
  if (!limited.allowed) {
    return NextResponse.json({ error: "Çok fazla deneme." }, { status: 429, headers: NO_STORE });
  }

  let body: {
    op?: string;
    body?: string;
    expectedRevision?: number;
    markSaved?: boolean;
    parentMessage?: string;
    supportRequest?: string;
    expectedDraftRevision?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400, headers: NO_STORE });
  }

  try {
    if (body.op === "update_body") {
      if (typeof body.expectedRevision !== "number") {
        return NextResponse.json({ error: "expectedRevision gerekli." }, { status: 400, headers: NO_STORE });
      }
      const entry = await updateJournalBody({
        childUserId: authz.session!.user.id,
        entryId: id,
        body: typeof body.body === "string" ? body.body : "",
        expectedRevision: body.expectedRevision,
        markSaved: body.markSaved,
      });
      return NextResponse.json({ entry }, { headers: NO_STORE });
    }

    if (body.op === "update_draft") {
      if (typeof body.expectedRevision !== "number") {
        return NextResponse.json({ error: "expectedRevision gerekli." }, { status: 400, headers: NO_STORE });
      }
      const entry = await updateSharingDraft({
        childUserId: authz.session!.user.id,
        entryId: id,
        parentMessage: body.parentMessage,
        supportRequest: body.supportRequest,
        expectedRevision: body.expectedRevision,
      });
      return NextResponse.json({ entry }, { headers: NO_STORE });
    }

    if (body.op === "publish") {
      if (typeof body.expectedDraftRevision !== "number") {
        return NextResponse.json({ error: "expectedDraftRevision gerekli." }, { status: 400, headers: NO_STORE });
      }
      const entry = await publishShare({
        childUserId: authz.session!.user.id,
        entryId: id,
        expectedDraftRevision: body.expectedDraftRevision,
      });
      return NextResponse.json({ entry }, { headers: NO_STORE });
    }

    if (body.op === "withdraw") {
      const entry = await withdrawShare({
        childUserId: authz.session!.user.id,
        entryId: id,
      });
      return NextResponse.json({ entry }, { headers: NO_STORE });
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
    await deleteJournalEntry({
      childUserId: authz.session!.user.id,
      entryId: id,
    });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
