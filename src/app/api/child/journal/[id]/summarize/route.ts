import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSummarizationProvider } from "@/lib/ai";
import { ProviderError } from "@/lib/ai/types";
import { PROMPT_OPTIONS } from "@/lib/constants";
import {
  createSummarySuggestion,
  getChildEntry,
  JournalError,
} from "@/lib/journal";
import { auth } from "@/lib/auth";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

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
  if (error instanceof ProviderError) {
    const status =
      error.code === "NOT_CONFIGURED"
        ? 503
        : error.code === "TIMEOUT"
          ? 504
          : error.code === "INVALID_OUTPUT"
            ? 502
            : 502;
    return NextResponse.json({ error: error.message, code: error.code }, { status, headers: NO_STORE });
  }
  console.error("summarize api error");
  return NextResponse.json({ error: "Özet önerisi alınamadı." }, { status: 500, headers: NO_STORE });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id: entryId } = await ctx.params;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(
    `summarize:${authz.session!.user.id}:${ip}`,
    10,
    60_000,
  );
  if (!limited.allowed) {
    return NextResponse.json({ error: "Çok fazla özet denemesi. Biraz bekle." }, { status: 429, headers: NO_STORE });
  }

  const provider = getSummarizationProvider();
  if (!provider.isConfigured()) {
    return NextResponse.json(
      {
        error: "Özet önerisi şu an kullanılamıyor. Yazarak devam edebilirsin.",
        code: "NOT_CONFIGURED",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  let body: { expectedRevision?: number; requestId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400, headers: NO_STORE });
  }

  if (typeof body.expectedRevision !== "number") {
    return NextResponse.json({ error: "expectedRevision gerekli." }, { status: 400, headers: NO_STORE });
  }

  const requestId =
    typeof body.requestId === "string" && body.requestId.trim().length >= 8
      ? body.requestId.trim().slice(0, 80)
      : randomUUID();

  try {
    const entryBefore = await getChildEntry(authz.session!.user.id, entryId);
    if (entryBefore.revision !== body.expectedRevision) {
      return NextResponse.json(
        { error: "Metin değişti. Yenileyip tekrar dene.", code: "CONFLICT" },
        { status: 409, headers: NO_STORE },
      );
    }
    if (!entryBefore.body.trim()) {
      return NextResponse.json(
        { error: "Önce bir şeyler yazmalısın.", code: "VALIDATION" },
        { status: 400, headers: NO_STORE },
      );
    }

    const promptLabel =
      PROMPT_OPTIONS.find((p) => p.key === entryBefore.promptKey)?.label ?? null;

    const result = await provider.summarize({
      sourceText: entryBefore.body,
      promptLabel,
    });

    // Guard: entry may have been deleted or edited during provider call.
    const still = await prisma.journalEntry.findFirst({
      where: { id: entryId },
      select: { id: true, revision: true, childId: true },
    });
    if (!still) {
      return NextResponse.json(
        { error: "Kayıt silindiği için öneri kaydedilmedi.", code: "GONE" },
        { status: 410, headers: NO_STORE },
      );
    }

    const child = await prisma.childProfile.findUnique({
      where: { userId: authz.session!.user.id },
      select: { id: true },
    });
    if (!child || still.childId !== child.id) {
      return NextResponse.json({ error: "Yetkisiz." }, { status: 403, headers: NO_STORE });
    }

    if (still.revision !== body.expectedRevision) {
      return NextResponse.json(
        {
          error: "Metni düzenledin; bu öneri artık güncel değil. İstersen yeniden iste.",
          code: "CONFLICT",
        },
        { status: 409, headers: NO_STORE },
      );
    }

    const entry = await createSummarySuggestion({
      childUserId: authz.session!.user.id,
      entryId,
      requestId,
      expectedRevision: body.expectedRevision,
      suggestedText: result.summary,
    });

    return NextResponse.json({ entry, requestId }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
