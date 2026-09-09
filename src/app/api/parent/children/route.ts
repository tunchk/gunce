import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Parent-only diagnostic of family children. Used by tests and never trusts client role claims.
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

  const membership = await prisma.familyMembership.findUnique({
    where: { userId: session.user.id },
    include: {
      family: {
        include: {
          children: {
            select: {
              id: true,
              displayName: true,
              ageGroup: true,
              timeZone: true,
              avatarKey: true,
            },
          },
        },
      },
    },
  });

  if (!membership) {
    return NextResponse.json({ family: null, children: [] });
  }

  return NextResponse.json({
    familyId: membership.familyId,
    children: membership.family.children,
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

  const membership = await prisma.familyMembership.findUnique({
    where: { userId: session.user.id },
  });

  if (!membership) {
    return NextResponse.json({ error: "Aile bulunamadı." }, { status: 404 });
  }

  const child = await prisma.childProfile.findFirst({
    where: { id: body.childId, familyId: membership.familyId },
    select: { id: true, displayName: true },
  });

  if (!child) {
    return NextResponse.json({ error: "Bu çocuğa erişimin yok." }, { status: 403 });
  }

  return NextResponse.json({ child });
}
