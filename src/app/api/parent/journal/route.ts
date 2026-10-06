import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { JournalError, listParentVisibleEntries } from "@/lib/journal";
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
    return NextResponse.json(
      { error: error.message },
      { status: 403, headers: NO_STORE },
    );
  }
  if (error instanceof JournalError) {
    const status = error.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: NO_STORE },
    );
  }
  console.error("parent journal api error");
  return NextResponse.json(
    { error: "İşlem başarısız." },
    { status: 500, headers: NO_STORE },
  );
}

export async function GET(request: NextRequest) {
  const authz = await requireParent(request);
  if (authz.error) return authz.error;
  try {
    const childId = new URL(request.url).searchParams.get("childId") || undefined;
    const entries = await listParentVisibleEntries(authz.session.user.id, childId);
    // Explicit fields only — never legacy private text mixed in.
    return NextResponse.json(
      {
        entries: entries.map((e) => ({
          entryId: e.entryId,
          childId: e.childId,
          childDisplayName: e.childDisplayName,
          diaryDate: e.diaryDate,
          updatedAt: e.updatedAt,
          body: e.body,
          revision: e.revision,
          kind: e.kind,
        })),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return mapError(error);
  }
}
