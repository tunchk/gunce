import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireGuardianAccess } from "@/lib/guardian";
import { SELECTED_CHILD_COOKIE } from "@/lib/parent-child-context";

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || role !== "PARENT") {
    return NextResponse.json({ error: "Kimlik doğrulama gerekli." }, { status: 401 });
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
    await requireGuardianAccess(session.user.id, body.childId);
  } catch {
    return NextResponse.json({ error: "Bu çocuğa erişimin yok." }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SELECTED_CHILD_COOKIE, body.childId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return res;
}
