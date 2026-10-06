import { NextRequest, NextResponse } from "next/server";
import { processJournalAiJobs } from "@/lib/journal-ai";
import { processDueReminders } from "@/lib/reminder";

export const runtime = "nodejs";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

/**
 * Processes reminders + journal AI jobs.
 * Same secret as reminders scheduler (REMINDER_SCHEDULER_SECRET).
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
    const [reminders, journalAi] = await Promise.all([
      processDueReminders(),
      processJournalAiJobs(),
    ]);
    return NextResponse.json(
      { ok: true, reminders, journalAi },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "İşleme başarısız." },
      { status: 500, headers: NO_STORE },
    );
  }
}
