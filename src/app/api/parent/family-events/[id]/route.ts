import { NextRequest, NextResponse } from "next/server";
import type { FamilyEventType } from "@prisma/client";
import { auth } from "@/lib/auth";
import {
  cancelFamilyEvent,
  getFamilyEvent,
  updateFamilyEvent,
  FamilyEventError,
} from "@/lib/family-events";
import { AuthorizationError } from "@/lib/session";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

type Ctx = { params: Promise<{ id: string }> };

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
  console.error("parent family event detail api error");
  return NextResponse.json({ error: "İşlem başarısız." }, { status: 500, headers: NO_STORE });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const authz = await requireParent(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;
  try {
    const event = await getFamilyEvent({
      viewerUserId: authz.session!.user.id,
      viewerRole: "PARENT",
      eventId: id,
    });
    return NextResponse.json({ event }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const authz = await requireParent(request);
  if ("error" in authz && authz.error) return authz.error;
  const { id } = await ctx.params;
  try {
    const body = (await request.json()) as {
      op?: string;
      title?: string;
      eventDate?: string;
      startTimeLocal?: string | null;
      endTimeLocal?: string | null;
      eventType?: FamilyEventType;
      note?: string;
    };
    if (body.op === "cancel") {
      const event = await cancelFamilyEvent({
        actorUserId: authz.session!.user.id,
        eventId: id,
      });
      return NextResponse.json({ event }, { headers: NO_STORE });
    }
    const event = await updateFamilyEvent({
      actorUserId: authz.session!.user.id,
      eventId: id,
      title: body.title,
      eventDate: body.eventDate,
      startTimeLocal: body.startTimeLocal,
      endTimeLocal: body.endTimeLocal,
      eventType: body.eventType,
      note: body.note,
    });
    return NextResponse.json({ event }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}
