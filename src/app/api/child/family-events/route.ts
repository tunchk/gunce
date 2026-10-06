import { NextRequest, NextResponse } from "next/server";
import type { FamilyEventType } from "@prisma/client";
import { auth } from "@/lib/auth";
import {
  createFamilyEvent,
  FamilyEventError,
} from "@/lib/family-events";
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
  if (error instanceof FamilyEventError) {
    const status =
      error.code === "NOT_FOUND" || error.code === "GONE" ? 404 : 400;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: NO_STORE },
    );
  }
  console.error("child family events api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const authz = await requireChild(request);
  if ("error" in authz && authz.error) return authz.error;

  const ip = clientIpFromHeaders(request.headers);
  const rl = await consumeRateLimit(
    `family-event:create:${authz.session!.user.id}:${ip}`,
    30,
    60_000,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Çok fazla istek. Biraz sonra dene." },
      { status: 429, headers: NO_STORE },
    );
  }

  try {
    const body = (await request.json()) as {
      title?: string;
      eventDate?: string;
      startTimeLocal?: string | null;
      endTimeLocal?: string | null;
      eventType?: FamilyEventType;
      note?: string;
    };
    if (!body.title || !body.eventDate || !body.eventType) {
      return NextResponse.json(
        { error: "Başlık, tarih ve tür gerekli." },
        { status: 400, headers: NO_STORE },
      );
    }
    const event = await createFamilyEvent({
      actorUserId: authz.session!.user.id,
      actorRole: "CHILD",
      title: body.title,
      eventDate: body.eventDate,
      startTimeLocal: body.startTimeLocal,
      endTimeLocal: body.endTimeLocal,
      eventType: body.eventType,
      note: body.note,
    });
    return NextResponse.json({ event }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
