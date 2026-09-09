import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createJournalEntry,
  listChildEntries,
  JournalError,
  PROMPT_OPTIONS,
} from "@/lib/journal";
import { AuthorizationError } from "@/lib/session";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import type { JournalPrompt } from "@prisma/client";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

async function requireChild(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) return { error: NextResponse.json({ error: "Kimlik doğrulama gerekli." }, { status: 401, headers: NO_STORE }) };
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
          : error.code === "VALIDATION" || error.code === "EMPTY_SHARE"
            ? 400
            : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status, headers: NO_STORE });
  }
  console.error("journal api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;

  try {
    const entries = await listChildEntries(authz.session!.user.id);
    return NextResponse.json({ entries, prompts: PROMPT_OPTIONS }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(`journal-create:${ip}`, 40, 60_000);
  if (!limited.allowed) {
    return NextResponse.json({ error: "Çok fazla deneme." }, { status: 429, headers: NO_STORE });
  }

  let body: {
    promptKey?: string | null;
    body?: string;
    clientRequestId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400, headers: NO_STORE });
  }

  const allowed = new Set(PROMPT_OPTIONS.map((p) => p.key));
  const promptKey =
    body.promptKey && allowed.has(body.promptKey as JournalPrompt)
      ? (body.promptKey as JournalPrompt)
      : null;

  try {
    const entry = await createJournalEntry({
      childUserId: authz.session!.user.id,
      promptKey,
      body: body.body,
      clientRequestId: body.clientRequestId,
    });
    return NextResponse.json({ entry }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
