import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  acceptHelpOffer,
  cancelHelpRequest,
  completeHelpRequest,
  getChildHelpRequest,
  HelpError,
} from "@/lib/help";
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
  if (error instanceof HelpError) {
    const status =
      error.code === "NOT_FOUND" || error.code === "GONE"
        ? 404
        : error.code === "CONFLICT"
          ? 409
          : 400;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: NO_STORE },
    );
  }
  console.error("child help detail api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;
  try {
    const helpRequest = await getChildHelpRequest(authz.session!.user.id, id);
    return NextResponse.json({ request: helpRequest }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;

  const ip = clientIpFromHeaders(request.headers);
  const rl = await consumeRateLimit(`help:patch:${authz.session!.user.id}:${ip}`, 40, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Çok fazla istek. Biraz sonra dene." },
      { status: 429, headers: NO_STORE },
    );
  }

  try {
    const body = (await request.json()) as {
      op?: string;
      offerId?: string;
    };
    if (body.op === "cancel") {
      const helpRequest = await cancelHelpRequest({
        childUserId: authz.session!.user.id,
        requestId: id,
      });
      return NextResponse.json({ request: helpRequest }, { headers: NO_STORE });
    }
    if (body.op === "complete") {
      const helpRequest = await completeHelpRequest({
        childUserId: authz.session!.user.id,
        requestId: id,
      });
      return NextResponse.json({ request: helpRequest }, { headers: NO_STORE });
    }
    if (body.op === "accept_offer") {
      if (!body.offerId) {
        return NextResponse.json(
          { error: "Teklif seç." },
          { status: 400, headers: NO_STORE },
        );
      }
      const helpRequest = await acceptHelpOffer({
        childUserId: authz.session!.user.id,
        requestId: id,
        offerId: body.offerId,
      });
      return NextResponse.json({ request: helpRequest }, { headers: NO_STORE });
    }
    return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400, headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
