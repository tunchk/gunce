import { NextRequest, NextResponse } from "next/server";
import { processDueReminders } from "@/lib/reminder";

export const runtime = "nodejs";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

/**
 * External scheduler entry point.
 * Requires REMINDER_SCHEDULER_SECRET via Authorization: Bearer <secret>
 * or header x-gunce-scheduler-secret.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.REMINDER_SCHEDULER_SECRET?.trim() || "";
  if (!expected || expected.length < 16) {
    return NextResponse.json(
      { error: "Zamanlayıcı yapılandırılmamış." },
      { status: 503, headers: NO_STORE },
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const headerSecret = request.headers.get("x-gunce-scheduler-secret")?.trim() || "";
  const provided = bearer || headerSecret;
  if (!provided || provided !== expected) {
    return NextResponse.json(
      { error: "Yetkisiz." },
      { status: 401, headers: NO_STORE },
    );
  }

  try {
    const result = await processDueReminders();
    return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
  } catch {
    console.error("scheduler process error");
    return NextResponse.json(
      { error: "İşlem başarısız." },
      { status: 500, headers: NO_STORE },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Yalnızca POST." },
    { status: 405, headers: NO_STORE },
  );
}
