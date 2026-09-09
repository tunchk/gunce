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
  const sessionCookie = hasSessionCookie(request);

  if ((pathname.startsWith("/veli") || pathname.startsWith("/api/parent")) && !sessionCookie) {
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
  matcher: ["/veli/:path*", "/cocuk/:path*", "/api/parent/:path*", "/api/child/:path*"],
};
