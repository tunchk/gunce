import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getParentGoals } from "@/lib/goal";
import { PlanError } from "@/lib/plan";
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
        { error: "Yalnızca veliler erişebilir." },
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
  if (error instanceof PlanError) {
    const status = error.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: NO_STORE },
    );
  }
  console.error("parent goals api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  const authz = await requireParent(request);
  if ("error" in authz && authz.error) return authz.error;
  try {
    const data = await getParentGoals(authz.session!.user.id);
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

const FORBIDDEN = NextResponse.json(
  { error: "Veliler hedefleri düzenleyemez." },
  { status: 403, headers: NO_STORE },
);

export async function POST() {
  return FORBIDDEN;
}
export async function PATCH() {
  return FORBIDDEN;
}
export async function PUT() {
  return FORBIDDEN;
}
export async function DELETE() {
  return FORBIDDEN;
}
