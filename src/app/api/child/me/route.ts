import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!session?.user) {
    return NextResponse.json({ error: "Kimlik doğrulama gerekli." }, { status: 401 });
  }

  if (role !== "CHILD") {
    return NextResponse.json({ error: "Yalnızca çocuk oturumu." }, { status: 403 });
  }

  const child = await prisma.childProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      displayName: true,
      avatarKey: true,
      onboardingStep: true,
    },
  });

  if (!child) {
    return NextResponse.json({ error: "Profil bulunamadı." }, { status: 404 });
  }

  return NextResponse.json({ child });
}
