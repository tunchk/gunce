import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listActiveGuardianAccesses, requireGuardianAccess } from "@/lib/guardian";

/**
 * Parent-accessible children via ChildGuardianAccess (not family membership alone).
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!session?.user) {
    return NextResponse.json({ error: "Kimlik doğrulama gerekli." }, { status: 401 });
  }

  if (role !== "PARENT") {
    return NextResponse.json({ error: "Yalnızca veliler erişebilir." }, { status: 403 });
  }

  const accesses = await listActiveGuardianAccesses(session.user.id);
  return NextResponse.json({
    children: accesses.map((a) => ({
      id: a.child.id,
      displayName: a.child.displayName,
      ageGroup: a.child.ageGroup,
      timeZone: a.child.timeZone,
      avatarKey: a.child.avatarKey,
      role: a.role,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!session?.user) {
    return NextResponse.json({ error: "Kimlik doğrulama gerekli." }, { status: 401 });
  }

  if (role !== "PARENT") {
    return NextResponse.json({ error: "Yalnızca veliler erişebilir." }, { status: 403 });
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

  const accesses = await listActiveGuardianAccesses(session.user.id);
  const hit = accesses.find((a) => a.childId === body.childId);
  if (!hit) {
    return NextResponse.json({ error: "Bu çocuğa erişimin yok." }, { status: 403 });
  }

  return NextResponse.json({
    child: {
      id: hit.child.id,
      displayName: hit.child.displayName,
    },
  });
}
