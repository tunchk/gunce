import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFamilyCoordinationWeek } from "@/lib/family-calendar";
import { FamilyEventError } from "@/lib/family-events";
import { AuthorizationError } from "@/lib/session";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

async function requireParent(request: NextRequest) {
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
  if (role !== "PARENT") {
    return {
      error: NextResponse.json(
        { error: "Yalnızca veli oturumu." },
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
  if (error instanceof FamilyEventError) {
    const status =
      error.code === "NOT_FOUND" || error.code === "GONE" ? 404 : 400;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: NO_STORE },
    );
  }
  console.error("parent family calendar api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  const authz = await requireParent(request);
  if ("error" in authz && authz.error) return authz.error;
  try {
    const url = new URL(request.url);
    const childId = url.searchParams.get("childId") || undefined;
    const weekStart = url.searchParams.get("weekStart") || undefined;
    if (!childId) {
      return NextResponse.json(
        { error: "Çocuk seçimi gerekli." },
        { status: 400, headers: NO_STORE },
      );
    }
    const week = await getFamilyCoordinationWeek({
      viewerUserId: authz.session!.user.id,
      viewerRole: "PARENT",
      childId,
      weekStartIso: weekStart,
    });
    return NextResponse.json({ week }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
