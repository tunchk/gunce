import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { HELP_TYPES, HelpError, createHelpRequest, listChildHelpRequests } from "@/lib/help";
import type { HelpType } from "@prisma/client";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { AuthorizationError } from "@/lib/session";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

async function requireChild(request: NextRequest) {
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
  if (role !== "CHILD") {
    return {
      error: NextResponse.json(
        { error: "Yalnızca çocuk oturumu." },
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
      error.code === "NOT_FOUND" || error.code === "GONE"
        ? 404
        : error.code === "CONFLICT"
          ? 409
          : 400;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: NO_STORE },
    );
  }
  console.error("child help api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;
  try {
    const requests = await listChildHelpRequests(authz.session!.user.id);
    return NextResponse.json({ requests }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;

  const ip = clientIpFromHeaders(request.headers);
  const rl = await consumeRateLimit(`help:create:${authz.session!.user.id}:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Çok fazla istek. Biraz sonra dene." },
      { status: 429, headers: NO_STORE },
    );
  }

  try {
    const body = (await request.json()) as {
      studyStepId?: string;
      commitmentId?: string;
      helpType?: string;
      note?: string;
    };
    if (!body.helpType || !HELP_TYPES.includes(body.helpType as HelpType)) {
      return NextResponse.json(
        { error: "Yardım türü seç." },
        { status: 400, headers: NO_STORE },
      );
    }
    const helpRequest = await createHelpRequest({
      childUserId: authz.session!.user.id,
      studyStepId: body.studyStepId,
      commitmentId: body.commitmentId,
      helpType: body.helpType as HelpType,
      note: body.note,
    });
    return NextResponse.json({ request: helpRequest }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
