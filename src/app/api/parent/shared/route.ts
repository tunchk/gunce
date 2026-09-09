import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { JournalError, listParentSharedContent, parentTryGetEntry } from "@/lib/journal";
import { AuthorizationError } from "@/lib/session";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

async function requireParent(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Kimlik doğrulama gerekli." }, { status: 401, headers: NO_STORE }) };
  }
  if (role !== "PARENT") {
    return { error: NextResponse.json({ error: "Yalnızca veliler erişebilir." }, { status: 403, headers: NO_STORE }) };
  }
  return { session };
}

function mapError(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE });
  }
  if (error instanceof JournalError) {
    const status = error.code === "NOT_FOUND" || error.code === "GONE" ? 404 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status, headers: NO_STORE });
  }
  console.error("parent shared api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  const authz = await requireParent(request);
  if ("error" in authz && authz.error) return authz.error;

  const entryId = new URL(request.url).searchParams.get("entryId");

  try {
    if (entryId) {
      const shared = await parentTryGetEntry(authz.session!.user.id, entryId);
      return NextResponse.json({ shared }, { headers: NO_STORE });
    }

    const data = await listParentSharedContent(authz.session!.user.id);
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

/** Parents are read-only for journal content. */
export async function PATCH(request: NextRequest) {
  void request;
  return NextResponse.json(
    { error: "Veliler paylaşılmış içeriği düzenleyemez." },
    { status: 403, headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  void request;
  return NextResponse.json(
    { error: "Veliler paylaşılmış içeriği düzenleyemez." },
    { status: 403, headers: NO_STORE },
  );
}

export async function PUT(request: NextRequest) {
  void request;
  return NextResponse.json(
    { error: "Veliler paylaşılmış içeriği düzenleyemez." },
    { status: 403, headers: NO_STORE },
  );
}

export async function DELETE(request: NextRequest) {
  void request;
  return NextResponse.json(
    { error: "Veliler paylaşılmış içeriği düzenleyemez." },
    { status: 403, headers: NO_STORE },
  );
}
