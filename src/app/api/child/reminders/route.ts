import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPushAdapter, getVapidPublicKey, isWebPushConfigured } from "@/lib/push";
import {
  getReminderPreferences,
  listActivePushStatus,
  ReminderError,
  updateReminderPreferences,
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

function mapError(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE });
  }
  if (error instanceof ReminderError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "CONFLICT"
          ? 409
          : error.code === "NOT_CONFIGURED"
            ? 503
            : 400;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: NO_STORE },
    );
  }
  console.error("reminders api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  try {
    const [preferences, device] = await Promise.all([
      getReminderPreferences(authz.session!.user.id),
      listActivePushStatus(authz.session!.user.id),
    ]);
    return NextResponse.json(
      {
        preferences,
        device,
        vapidPublicKey: isWebPushConfigured() ? getVapidPublicKey() : null,
        pushConfigured: getPushAdapter().isConfigured(),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return mapError(error);
  }
}

export async function PATCH(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(
    `reminder-prefs:${authz.session!.user.id}:${ip}`,
    30,
    60_000,
  );
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Çok fazla deneme." },
      { status: 429, headers: NO_STORE },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400, headers: NO_STORE });
  }

  if (typeof body.expectedRevision !== "number") {
    return NextResponse.json(
      { error: "expectedRevision gerekli." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const preferences = await updateReminderPreferences({
      childUserId: authz.session!.user.id,
      expectedRevision: body.expectedRevision,
      journalReminderEnabled:
        typeof body.journalReminderEnabled === "boolean"
          ? body.journalReminderEnabled
          : undefined,
      journalReminderLocalTime:
        typeof body.journalReminderLocalTime === "string"
          ? body.journalReminderLocalTime
          : undefined,
      studyRemindersEnabled:
        typeof body.studyRemindersEnabled === "boolean"
          ? body.studyRemindersEnabled
          : undefined,
      quietHoursStart:
        typeof body.quietHoursStart === "string" ? body.quietHoursStart : undefined,
      quietHoursEnd:
        typeof body.quietHoursEnd === "string" ? body.quietHoursEnd : undefined,
    });
    return NextResponse.json({ preferences }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
