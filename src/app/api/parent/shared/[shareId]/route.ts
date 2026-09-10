import { NextRequest, NextResponse } from "next/server";
import { getParentGuidanceProvider } from "@/lib/ai";
import { ProviderError } from "@/lib/ai/types";
import { auth } from "@/lib/auth";
import {
  getOrCreateParentGuidance,
  getParentShareDetail,
  JournalError,
} from "@/lib/journal";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/session";

export const runtime = "nodejs";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

type Ctx = { params: Promise<{ shareId: string }> };

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
        { error: "Yalnızca veliler erişebilir." },
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
  if (error instanceof JournalError) {
    const status =
      error.code === "NOT_FOUND" || error.code === "GONE" ? 404 : 400;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: NO_STORE },
    );
  }
  if (error instanceof ProviderError) {
    const status =
      error.code === "NOT_CONFIGURED"
        ? 503
        : error.code === "TIMEOUT"
          ? 504
          : 502;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: NO_STORE },
    );
  }
  console.error("parent share detail api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const authz = await requireParent(request);
  if ("error" in authz && authz.error) return authz.error;
  const { shareId } = await ctx.params;

  try {
    const share = await getParentShareDetail(authz.session!.user.id, shareId);
    return NextResponse.json({ share }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

/** Generate or reuse approach tips for this published snapshot. */
export async function POST(request: NextRequest, ctx: Ctx) {
  const authz = await requireParent(request);
  if ("error" in authz && authz.error) return authz.error;
  const { shareId } = await ctx.params;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(
    `parent-guidance:${authz.session!.user.id}:${ip}`,
    20,
    60_000,
  );
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Çok fazla deneme. Biraz bekle." },
      { status: 429, headers: NO_STORE },
    );
  }

  // Always return share first path for readability even when AI fails —
  // clients should GET share separately; this endpoint focuses on guidance.
  try {
    // Ensure share is readable before spending provider quota.
    await getParentShareDetail(authz.session!.user.id, shareId);

    const provider = getParentGuidanceProvider();
    if (!provider.isConfigured()) {
      return NextResponse.json(
        {
          guidance: {
            available: false,
            reason: "Yaklaşım önerisi şu an kullanılamıyor. Paylaşılan metin yine de okunabilir.",
          },
        },
        { status: 200, headers: NO_STORE },
      );
    }

    const guidance = await getOrCreateParentGuidance({
      parentUserId: authz.session!.user.id,
      shareId,
      generate: (args) => provider.generate(args),
    });

    return NextResponse.json({ guidance }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
