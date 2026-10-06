import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { HelpError, listParentHelpInbox } from "@/lib/help";
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
  if (error instanceof HelpError) {
    const status =
      error.code === "NOT_FOUND" || error.code === "GONE" ? 404 : 400;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: NO_STORE },
    );
  }
  console.error("parent help api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  const authz = await requireParent(request);
  if ("error" in authz && authz.error) return authz.error;
  const childId = request.nextUrl.searchParams.get("childId") || undefined;
  try {
    const inbox = await listParentHelpInbox(authz.session!.user.id, childId);
    return NextResponse.json(inbox, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
