import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function hasSessionCookie(request: NextRequest): boolean {
  const cookie = request.headers.get("cookie") || "";
  return (
    cookie.includes("better-auth.session_token=") ||
    cookie.includes("__Secure-better-auth.session_token=")
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Milestone 9: Better Auth's verify-email is GET-only and would consume JWTs
  // when scanners open the default URL. App links use /veli/eposta-dogrula + POST.
  if (
    request.method === "GET" &&
    (pathname === "/api/auth/verify-email" ||
      pathname.startsWith("/api/auth/verify-email?"))
  ) {
    return NextResponse.json(
      {
        error:
          "E-posta doğrulama bağlantıyı yalnızca açmakla tamamlanmaz. Onay sayfasındaki düğmeyi kullan.",
        code: "VERIFY_EMAIL_GET_DISABLED",
      },
      { status: 405 },
    );
  }

  const sessionCookie = hasSessionCookie(request);

  if ((pathname.startsWith("/veli") || pathname.startsWith("/api/parent")) && !sessionCookie) {
    // Token pages must remain reachable without a session (email links).
    if (
      pathname.startsWith("/veli/eposta-dogrula") ||
      pathname.startsWith("/veli/sifre-yenile") ||
      pathname.startsWith("/veli/sifremi-unuttum") ||
      pathname.startsWith("/veli/davet")
    ) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Kimlik doğrulama gerekli." }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/giris", request.url));
  }

  if (
    pathname.startsWith("/cocuk") &&
    !pathname.startsWith("/cocuk/giris") &&
    !sessionCookie
  ) {
    return NextResponse.redirect(new URL("/cocuk/giris", request.url));
  }

  if (pathname.startsWith("/api/child") && !sessionCookie) {
    return NextResponse.json({ error: "Kimlik doğrulama gerekli." }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/veli/:path*",
    "/cocuk/:path*",
    "/api/parent/:path*",
    "/api/child/:path*",
    "/api/auth/verify-email",
  ],
};
