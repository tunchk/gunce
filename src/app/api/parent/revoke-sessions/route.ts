import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { revokeChildSessions } from "@/lib/family";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/session";

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || role !== "PARENT") {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const ip = clientIpFromHeaders(request.headers);
  const limited = await consumeRateLimit(`revoke:${ip}`, 20, 60_000);
  if (!limited.allowed) {
    return NextResponse.json({ error: "Çok fazla deneme." }, { status: 429 });
  }

  let body: { childId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  if (!body.childId) {
    return NextResponse.json({ error: "childId gerekli." }, { status: 400 });
  }

  try {
    await revokeChildSessions({
      parentUserId: session.user.id,
      childId: body.childId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "İşlem başarısız." }, { status: 500 });
  }
}
