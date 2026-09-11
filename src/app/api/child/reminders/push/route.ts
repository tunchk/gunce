import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  registerPushSubscription,
  ReminderError,
  sendTestPushToChild,
} from "@/lib/reminder";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/session";

export const runtime = "nodejs";

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

export async function POST(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(
    `push-sub:${authz.session!.user.id}:${ip}`,
    20,
    60_000,
  );
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Çok fazla deneme." },
      { status: 429, headers: NO_STORE },
    );
  }

  let body: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    userAgent?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400, headers: NO_STORE });
  }

  try {
    const sub = await registerPushSubscription({
      childUserId: authz.session!.user.id,
      sessionId: authz.session!.session.id,
      endpoint: body.endpoint || "",
      p256dh: body.keys?.p256dh || "",
      auth: body.keys?.auth || "",
      userAgent: body.userAgent || request.headers.get("user-agent") || "",
    });
    return NextResponse.json(
      { ok: true, subscriptionId: sub.id },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE });
    }
    if (error instanceof ReminderError) {
      const status =
        error.code === "NOT_CONFIGURED"
          ? 503
          : error.code === "FORBIDDEN"
            ? 403
            : 400;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status, headers: NO_STORE },
      );
    }
    return NextResponse.json({ error: "Kayıt başarısız." }, { status: 500, headers: NO_STORE });
  }
}

/** Rate-limited test notification for the current device. */
export async function PUT(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(
    `push-test:${authz.session!.user.id}:${ip}`,
    5,
    60_000,
  );
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Çok fazla deneme bildirimi. Biraz bekle." },
      { status: 429, headers: NO_STORE },
    );
  }

  try {
    const result = await sendTestPushToChild({
      childUserId: authz.session!.user.id,
      sessionId: authz.session!.session.id,
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ReminderError) {
      const status = error.code === "NOT_CONFIGURED" ? 503 : 400;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { error: "Deneme bildirimi gönderilemedi." },
      { status: 500, headers: NO_STORE },
    );
  }
}
