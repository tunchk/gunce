import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationError,
} from "@/lib/notifications";
import { AuthorizationError } from "@/lib/session";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

async function requireUser(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return {
      error: NextResponse.json(
        { error: "Kimlik doğrulama gerekli." },
        { status: 401, headers: NO_STORE },
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
  if (error instanceof NotificationError) {
    const status = error.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: NO_STORE },
    );
  }
  console.error("notifications api error");
  return NextResponse.json(
    { error: "İşlem başarısız." },
    { status: 500, headers: NO_STORE },
  );
}

export async function GET(request: NextRequest) {
  const authz = await requireUser(request);
  if (authz.error) return authz.error;

  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") === "unread" ? "unread" : "all";
  const cursor = url.searchParams.get("cursor");
  const unreadOnly = url.searchParams.get("countOnly") === "1";

  try {
    if (unreadOnly) {
      const unreadCount = await countUnreadNotifications(authz.session.user.id);
      return NextResponse.json({ unreadCount }, { headers: NO_STORE });
    }
    const page = await listNotifications({
      recipientUserId: authz.session.user.id,
      filter,
      cursor,
    });
    const unreadCount = await countUnreadNotifications(authz.session.user.id);
    return NextResponse.json({ ...page, unreadCount }, { headers: NO_STORE });
  } catch (error) {
    return mapError(error);
  }
}

export async function PATCH(request: NextRequest) {
  const authz = await requireUser(request);
  if (authz.error) return authz.error;

  try {
    const body = (await request.json()) as {
      op?: string;
      notificationId?: string;
    };
    if (body.op === "read_all") {
      const result = await markAllNotificationsRead(authz.session.user.id);
      return NextResponse.json(result, { headers: NO_STORE });
    }
    if (body.op === "read" && body.notificationId) {
      const item = await markNotificationRead({
        recipientUserId: authz.session.user.id,
        notificationId: body.notificationId,
      });
      return NextResponse.json({ item }, { headers: NO_STORE });
    }
    return NextResponse.json(
      { error: "Geçersiz işlem." },
      { status: 400, headers: NO_STORE },
    );
  } catch (error) {
    return mapError(error);
  }
}
