/**
 * Validated application origin for auth email links.
 * Never trust Host / X-Forwarded-Host or open redirect parameters.
 */

function parseAbsoluteOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Configured public origin (BETTER_AUTH_URL, else NEXT_PUBLIC_APP_URL). */
export function getAppOrigin(): string {
  const fromAuth = parseAbsoluteOrigin(process.env.BETTER_AUTH_URL);
  if (fromAuth) return fromAuth;
  const fromPublic = parseAbsoluteOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (fromPublic) return fromPublic;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_URL (or NEXT_PUBLIC_APP_URL) must be an absolute http(s) origin");
  }
  return "http://localhost:3000";
}

/** Reject callback/redirect targets outside the configured origin. */
export function isSameAppOrigin(candidate: string): boolean {
  try {
    const origin = getAppOrigin();
    const url = new URL(candidate, origin);
    return url.origin === origin;
  } catch {
    return false;
  }
}
