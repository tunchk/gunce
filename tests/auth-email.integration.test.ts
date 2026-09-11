import { describe, expect, it, beforeEach } from "vitest";
import { SignJWT } from "jose";
import {
  clearCapturedMails,
  extractLinkFromMail,
  findCapturedMail,
  getCapturedMails,
  getMailTransportKind,
  isMailDeliveryAvailable,
  sendMail,
  MailDeliveryError,
} from "@/lib/mail";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  createParent,
  onboardParentWithChild,
  createPairingInvitation,
  redeemPairingInvitation,
  signInAndGetCookie,
} from "./helpers";

function cookieHeaderFromSetCookie(setCookie: string | null): string {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=\s*[^;]+=)/)
    .map((part) => part.split(";")[0]!.trim())
    .filter(Boolean)
    .join("; ");
}

function tokenFromLink(link: string | null): string {
  expect(link).toBeTruthy();
  const url = new URL(link!);
  const token = url.searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
}

async function signUpParent(email: string, password = "Password123!") {
  const response = (await auth.api.signUpEmail({
    body: { name: "Veli Test", email, password },
    headers: new Headers({
      origin: "http://localhost:3000",
      "content-type": "application/json",
    }),
    asResponse: true,
  })) as Response;
  expect(response.ok).toBe(true);
  return response;
}

describe("mail transport", () => {
  beforeEach(() => {
    clearCapturedMails();
  });

  it("uses memory capture in tests and refuses preview/capture on non-loopback production", async () => {
    expect(getMailTransportKind()).toBe("memory");
    expect(isMailDeliveryAvailable()).toBe(true);

    await sendMail({
      to: "a@example.com",
      subject: "t",
      text: "hello https://example.com/x",
    });
    expect(getCapturedMails()).toHaveLength(1);

    const prev = process.env.NODE_ENV;
    const prevPreview = process.env.GUNCE_MAIL_PREVIEW;
    const prevCapture = process.env.GUNCE_MAIL_TEST_CAPTURE;
    const prevAllow = process.env.GUNCE_ALLOW_MAIL_TEST_CAPTURE;
    const prevUrl = process.env.BETTER_AUTH_URL;
    try {
      (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
      process.env.GUNCE_MAIL_TEST_CAPTURE = "0";
      process.env.GUNCE_ALLOW_MAIL_TEST_CAPTURE = "0";
      process.env.GUNCE_MAIL_PREVIEW = "1";
      await expect(
        sendMail({ to: "b@example.com", subject: "x", text: "y" }),
      ).rejects.toBeInstanceOf(MailDeliveryError);

      // Even with ALLOW, non-loopback production host cannot capture.
      process.env.GUNCE_MAIL_TEST_CAPTURE = "1";
      process.env.GUNCE_ALLOW_MAIL_TEST_CAPTURE = "1";
      process.env.GUNCE_MAIL_PREVIEW = "0";
      process.env.BETTER_AUTH_URL = "https://gunce.example.com";
      await expect(
        sendMail({ to: "c@example.com", subject: "x", text: "y" }),
      ).rejects.toBeInstanceOf(MailDeliveryError);
    } finally {
      (process.env as { NODE_ENV?: string }).NODE_ENV = prev;
      process.env.GUNCE_MAIL_PREVIEW = prevPreview;
      process.env.GUNCE_MAIL_TEST_CAPTURE = prevCapture;
      process.env.GUNCE_ALLOW_MAIL_TEST_CAPTURE = prevAllow;
      process.env.BETTER_AUTH_URL = prevUrl;
    }
  });
});

describe("parent email verification", () => {
  beforeEach(() => {
    clearCapturedMails();
  });

  it("keeps registration unverified and verifies only with a valid token", async () => {
    const email = `verify_${Date.now()}@example.com`;
    await signUpParent(email);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerified).toBe(false);

    const mail = findCapturedMail((m) => m.to === email);
    expect(mail?.subject).toMatch(/doğrula/i);
    const token = tokenFromLink(extractLinkFromMail(mail!));
    expect(extractLinkFromMail(mail!)!).toContain("/veli/eposta-dogrula");

    // Opening the link alone does not call verify — user stays unverified.
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerified,
    ).toBe(false);

    const { consumeEmailVerifyRedemption } = await import(
      "@/lib/email-verify-redemption"
    );
    const userId = await consumeEmailVerifyRedemption(token);
    expect(userId).toBe(user.id);
    await auth.api.verifyEmail({ query: { token } });

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerified,
    ).toBe(true);

    // Second consume fails (single-use)
    expect(await consumeEmailVerifyRedemption(token)).toBeNull();
  });

  it("allows only one concurrent verification redemption", async () => {
    const email = `vrace_${Date.now()}@example.com`;
    await signUpParent(email);
    const mail = findCapturedMail((m) => m.to === email);
    const token = tokenFromLink(extractLinkFromMail(mail!));
    const { consumeEmailVerifyRedemption } = await import(
      "@/lib/email-verify-redemption"
    );
    const [a, b] = await Promise.all([
      consumeEmailVerifyRedemption(token),
      consumeEmailVerifyRedemption(token),
    ]);
    const wins = [a, b].filter(Boolean);
    expect(wins).toHaveLength(1);
  });

  it("rejects expired, invalid, and wrong-purpose tokens", async () => {
    const email = `badtok_${Date.now()}@example.com`;
    await createParent({ email });

    const secret = process.env.BETTER_AUTH_SECRET!;
    const expired = await new SignJWT({ email })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("0s")
      .sign(new TextEncoder().encode(secret));

    await expect(
      auth.api.verifyEmail({ query: { token: expired } }),
    ).rejects.toBeTruthy();

    await expect(
      auth.api.verifyEmail({
        query: { token: "not-a-real-jwt-token-value" },
      }),
    ).rejects.toBeTruthy();

    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/veli/sifre-yenile" },
      headers: new Headers({ origin: "http://localhost:3000" }),
    });
    const resetMail = findCapturedMail(
      (m) => m.to === email && /şifre/i.test(m.subject),
    );
    const resetToken = tokenFromLink(extractLinkFromMail(resetMail!));
    await expect(
      auth.api.verifyEmail({ query: { token: resetToken } }),
    ).rejects.toBeTruthy();

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerified,
    ).toBe(false);
  });

  it("enforces resend cooldown via rate limit key", async () => {
    const parent = await createParent();
    const first = await consumeRateLimit(
      `action:verify-resend-user:${parent.user.id}`,
      1,
      60_000,
    );
    expect(first.allowed).toBe(true);
    const second = await consumeRateLimit(
      `action:verify-resend-user:${parent.user.id}`,
      1,
      60_000,
    );
    expect(second.allowed).toBe(false);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("does not mark verified when delivery fails on signup", async () => {
    const prev = process.env.GUNCE_MAIL_TEST_CAPTURE;
    process.env.GUNCE_MAIL_TEST_CAPTURE = "0";
    try {
      const email = `nodeliver_${Date.now()}@example.com`;
      const response = (await auth.api.signUpEmail({
        body: {
          name: "Veli",
          email,
          password: "Password123!",
        },
        headers: new Headers({ origin: "http://localhost:3000" }),
        asResponse: true,
      })) as Response;
      expect(response.ok).toBe(true);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { email } }))
          .emailVerified,
      ).toBe(false);
    } finally {
      process.env.GUNCE_MAIL_TEST_CAPTURE = prev;
    }
  });
});

describe("parent password recovery", () => {
  beforeEach(() => {
    clearCapturedMails();
  });

  it("returns equivalent public responses for known and unknown emails", async () => {
    const known = `known_${Date.now()}@example.com`;
    await createParent({ email: known });

    const r1 = (await auth.api.requestPasswordReset({
      body: { email: known, redirectTo: "/veli/sifre-yenile" },
      headers: new Headers({ origin: "http://localhost:3000" }),
      asResponse: true,
    })) as Response;

    const r2 = (await auth.api.requestPasswordReset({
      body: {
        email: `unknown_${Date.now()}@example.com`,
        redirectTo: "/veli/sifre-yenile",
      },
      headers: new Headers({ origin: "http://localhost:3000" }),
      asResponse: true,
    })) as Response;

    expect(r1.status).toBe(r2.status);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.status).toBe(true);
    expect(j2.status).toBe(true);
    expect(j1.message).toBe(j2.message);
  });

  it("resets password, revokes parent sessions and outstanding tokens, leaves others intact", async () => {
    const parent = await createParent({
      email: `reset_${Date.now()}@example.com`,
    });
    const other = await createParent({
      email: `other_${Date.now()}@example.com`,
      password: "OtherPass123!",
    });
    const child = await onboardParentWithChild(parent.user.id);
    const { token: invite } = await createPairingInvitation({
      parentUserId: parent.user.id,
      childId: child.id,
    });
    const redeem = await redeemPairingInvitation({
      token: invite,
      requestHeaders: new Headers({ origin: "http://localhost:3000" }),
    });
    const childCookie = cookieHeaderFromSetCookie(
      redeem.responseHeaders.get("set-cookie"),
    );

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    const otherCookie = await signInAndGetCookie(other.email, other.password);

    await auth.api.requestPasswordReset({
      body: { email: parent.email, redirectTo: "/veli/sifre-yenile" },
      headers: new Headers({ origin: "http://localhost:3000" }),
    });
    await auth.api.requestPasswordReset({
      body: { email: parent.email, redirectTo: "/veli/sifre-yenile" },
      headers: new Headers({ origin: "http://localhost:3000" }),
    });

    const resetMails = getCapturedMails().filter(
      (m) => m.to === parent.email && /şifre/i.test(m.subject),
    );
    expect(resetMails.length).toBeGreaterThanOrEqual(2);
    const olderToken = tokenFromLink(extractLinkFromMail(resetMails[0]!));
    const newerToken = tokenFromLink(extractLinkFromMail(resetMails.at(-1)!));
    expect(extractLinkFromMail(resetMails.at(-1)!)!).toContain(
      "/veli/sifre-yenile",
    );

    const before = await prisma.verification.count({
      where: { identifier: { startsWith: "reset-password:" } },
    });
    expect(before).toBeGreaterThanOrEqual(2);

    const newPassword = "NewPassword123!";
    await auth.api.resetPassword({
      body: { newPassword, token: newerToken },
    });

    const userAfter = await prisma.user.findUniqueOrThrow({
      where: { id: parent.user.id },
    });
    expect(userAfter.emailVerified).toBe(false);

    const leftover = await prisma.verification.count({
      where: {
        value: parent.user.id,
        identifier: { startsWith: "reset-password:" },
      },
    });
    expect(leftover).toBe(0);

    await expect(
      auth.api.resetPassword({
        body: { newPassword: "AnotherPass123!", token: olderToken },
      }),
    ).rejects.toBeTruthy();

    await expect(
      signInAndGetCookie(parent.email, parent.password),
    ).rejects.toThrow();
    expect(await signInAndGetCookie(parent.email, newPassword)).toBeTruthy();

    const { GET: getParentChildren } = await import(
      "@/app/api/parent/children/route"
    );
    const stale = await getParentChildren(
      new Request("http://localhost:3000/api/parent/children", {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }) as unknown as import("next/server").NextRequest,
    );
    expect(stale.status).toBe(401);

    const otherOk = await getParentChildren(
      new Request("http://localhost:3000/api/parent/children", {
        headers: { cookie: otherCookie, origin: "http://localhost:3000" },
      }) as unknown as import("next/server").NextRequest,
    );
    expect(otherOk.status).toBe(200);

    const { GET: getChildMe } = await import("@/app/api/child/me/route");
    const childOk = await getChildMe(
      new Request("http://localhost:3000/api/child/me", {
        headers: { cookie: childCookie, origin: "http://localhost:3000" },
      }) as unknown as import("next/server").NextRequest,
    );
    expect(childOk.status).toBe(200);
  });

  it("allows only one concurrent successful redemption", async () => {
    const parent = await createParent({
      email: `race_${Date.now()}@example.com`,
    });
    await auth.api.requestPasswordReset({
      body: { email: parent.email, redirectTo: "/veli/sifre-yenile" },
      headers: new Headers({ origin: "http://localhost:3000" }),
    });
    const mail = findCapturedMail((m) => m.to === parent.email);
    const token = tokenFromLink(extractLinkFromMail(mail!));

    const [a, b] = await Promise.allSettled([
      auth.api.resetPassword({
        body: { newPassword: "RacePass111!", token },
      }),
      auth.api.resetPassword({
        body: { newPassword: "RacePass222!", token },
      }),
    ]);
    const successes = [a, b].filter((r) => r.status === "fulfilled");
    expect(successes).toHaveLength(1);

    const attempts = await Promise.allSettled([
      signInAndGetCookie(parent.email, "RacePass111!"),
      signInAndGetCookie(parent.email, "RacePass222!"),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
