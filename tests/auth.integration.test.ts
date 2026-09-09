import { describe, expect, it } from "vitest";
import { GET as getParentChildren, POST as postParentChild } from "@/app/api/parent/children/route";
import { GET as getChildMe } from "@/app/api/child/me/route";
import { POST as redeemRoute } from "@/app/api/pairing/redeem/route";
import { POST as revokeRoute } from "@/app/api/parent/revoke-sessions/route";
import {
  createParent,
  onboardParentWithChild,
  prisma,
  createPairingInvitation,
  redeemPairingInvitation,
  revokeChildSessions,
  signInAndGetCookie,
} from "./helpers";
import { hashToken } from "@/lib/crypto";
import { upsertChildDuringOnboarding } from "@/lib/family";
import { auth } from "@/lib/auth";

function request(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as import("next/server").NextRequest;
}

function cookieHeaderFromSetCookie(setCookie: string | null): string {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=\s*[^;]+=)/)
    .map((part) => part.split(";")[0]!.trim())
    .filter(Boolean)
    .join("; ");
}

describe("Günce authorization & pairing", () => {
  it("rejects unauthenticated access to protected parent and child APIs", async () => {
    const parentRes = await getParentChildren(request("http://localhost:3000/api/parent/children"));
    expect(parentRes.status).toBe(401);

    const childRes = await getChildMe(request("http://localhost:3000/api/child/me"));
    expect(childRes.status).toBe(401);

    const revokeRes = await revokeRoute(
      request("http://localhost:3000/api/parent/revoke-sessions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ childId: "x" }),
      }),
    );
    expect(revokeRes.status).toBe(401);
  });

  it("blocks children from parent APIs and parents from child APIs", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const { token } = await createPairingInvitation({
      parentUserId: parent.user.id,
      childId: child.id,
    });

    const redeem = await redeemPairingInvitation({
      token,
      requestHeaders: new Headers({ origin: "http://localhost:3000" }),
    });
    const childCookie = cookieHeaderFromSetCookie(redeem.responseHeaders.get("set-cookie"));
    expect(childCookie).toBeTruthy();

    const parentApiAsChild = await getParentChildren(
      request("http://localhost:3000/api/parent/children", {
        headers: { cookie: childCookie, origin: "http://localhost:3000" },
      }),
    );
    expect(parentApiAsChild.status).toBe(403);

    const childApiAsChild = await getChildMe(
      request("http://localhost:3000/api/child/me", {
        headers: { cookie: childCookie, origin: "http://localhost:3000" },
      }),
    );
    expect(childApiAsChild.status).toBe(200);
    expect((await childApiAsChild.json()).child.displayName).toBe("Deniz");

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    const childApiAsParent = await getChildMe(
      request("http://localhost:3000/api/child/me", {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
    );
    expect(childApiAsParent.status).toBe(403);
  });

  it("prevents one family from accessing another family's child", async () => {
    const parentA = await createParent({ email: "a@example.com" });
    const parentB = await createParent({ email: "b@example.com", password: "Password123!" });
    const childA = await onboardParentWithChild(parentA.user.id);
    await onboardParentWithChild(parentB.user.id);

    const cookie = await signInAndGetCookie(parentB.email, parentB.password);

    const res = await postParentChild(
      request("http://localhost:3000/api/parent/children", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ childId: childA.id }),
      }),
    );

    expect(res.status).toBe(403);

    const revokeForeign = await revokeRoute(
      request("http://localhost:3000/api/parent/revoke-sessions", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ childId: childA.id }),
      }),
    );
    expect(revokeForeign.status).toBe(403);
  });

  it("rejects expired, redeemed, and revoked pairing invitations", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);

    const expiredToken = "expired-token-value-aaaaaaaaaaaa";
    await prisma.pairingInvitation.create({
      data: {
        childId: child.id,
        createdByUserId: parent.user.id,
        tokenHash: hashToken(expiredToken),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await expect(
      redeemPairingInvitation({
        token: expiredToken,
        requestHeaders: new Headers({ origin: "http://localhost:3000" }),
      }),
    ).rejects.toMatchObject({ code: "EXPIRED" });

    const { token: liveToken } = await createPairingInvitation({
      parentUserId: parent.user.id,
      childId: child.id,
    });
    await redeemPairingInvitation({
      token: liveToken,
      requestHeaders: new Headers({ origin: "http://localhost:3000" }),
    });
    await expect(
      redeemPairingInvitation({
        token: liveToken,
        requestHeaders: new Headers({ origin: "http://localhost:3000" }),
      }),
    ).rejects.toMatchObject({ code: "REDEEMED" });

    const { token: revokedToken, invitation } = await createPairingInvitation({
      parentUserId: parent.user.id,
      childId: child.id,
    });
    await prisma.pairingInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });
    await expect(
      redeemPairingInvitation({
        token: revokedToken,
        requestHeaders: new Headers({ origin: "http://localhost:3000" }),
      }),
    ).rejects.toMatchObject({ code: "REVOKED" });
  });

  it("allows only one concurrent redemption of the same invitation", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const { token } = await createPairingInvitation({
      parentUserId: parent.user.id,
      childId: child.id,
    });

    const results = await Promise.allSettled([
      redeemPairingInvitation({
        token,
        requestHeaders: new Headers({ origin: "http://localhost:3000" }),
      }),
      redeemPairingInvitation({
        token,
        requestHeaders: new Headers({ origin: "http://localhost:3000" }),
      }),
      redeemPairingInvitation({
        token,
        requestHeaders: new Headers({ origin: "http://localhost:3000" }),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(2);

    const childUsers = await prisma.user.findMany({ where: { role: "CHILD" } });
    expect(childUsers.length).toBe(1);

    const invitation = await prisma.pairingInvitation.findFirst({
      where: { childId: child.id, redeemedAt: { not: null } },
    });
    expect(invitation).toBeTruthy();
  });

  it("invalidates child sessions after parent revocation", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const { token } = await createPairingInvitation({
      parentUserId: parent.user.id,
      childId: child.id,
    });
    const redeem = await redeemPairingInvitation({
      token,
      requestHeaders: new Headers({ origin: "http://localhost:3000" }),
    });
    const cookie = cookieHeaderFromSetCookie(redeem.responseHeaders.get("set-cookie"));

    const before = await getChildMe(
      request("http://localhost:3000/api/child/me", {
        headers: { cookie, origin: "http://localhost:3000" },
      }),
    );
    expect(before.status).toBe(200);

    await revokeChildSessions({
      parentUserId: parent.user.id,
      childId: child.id,
    });

    const after = await getChildMe(
      request("http://localhost:3000/api/child/me", {
        headers: { cookie, origin: "http://localhost:3000" },
      }),
    );
    expect(after.status).toBe(401);
  });

  it("clears the parent session on a shared device when the child pairs", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const parentCookie = await signInAndGetCookie(parent.email, parent.password);

    const before = await auth.api.getSession({
      headers: new Headers({ cookie: parentCookie, origin: "http://localhost:3000" }),
    });
    expect(before?.user?.id).toBe(parent.user.id);
    expect((before?.user as { role?: string } | undefined)?.role).toBe("PARENT");
    const parentSessionToken = before!.session.token;

    const { token } = await createPairingInvitation({
      parentUserId: parent.user.id,
      childId: child.id,
    });

    const redeem = await redeemPairingInvitation({
      token,
      requestHeaders: new Headers({
        cookie: parentCookie,
        origin: "http://localhost:3000",
      }),
    });
    const childCookie = cookieHeaderFromSetCookie(redeem.responseHeaders.get("set-cookie"));
    expect(childCookie).toBeTruthy();

    // Previous parent session row must be gone from the database.
    const parentSessionStillThere = await prisma.session.findFirst({
      where: { token: parentSessionToken },
    });
    expect(parentSessionStillThere).toBeNull();

    // Old parent cookie must no longer authenticate as the parent.
    const oldParentSession = await auth.api.getSession({
      headers: new Headers({ cookie: parentCookie, origin: "http://localhost:3000" }),
    });
    expect(oldParentSession).toBeNull();

    // Device now has a child session; parent APIs are forbidden.
    const childSession = await auth.api.getSession({
      headers: new Headers({ cookie: childCookie, origin: "http://localhost:3000" }),
    });
    expect((childSession?.user as { role?: string } | undefined)?.role).toBe("CHILD");

    const parentApi = await getParentChildren(
      request("http://localhost:3000/api/parent/children", {
        headers: { cookie: childCookie, origin: "http://localhost:3000" },
      }),
    );
    expect(parentApi.status).toBe(403);

    // Returning to the parent area requires a fresh parent sign-in.
    const parentAgain = await signInAndGetCookie(parent.email, parent.password);
    const restored = await getParentChildren(
      request("http://localhost:3000/api/parent/children", {
        headers: { cookie: parentAgain, origin: "http://localhost:3000" },
      }),
    );
    expect(restored.status).toBe(200);
  });

  it("does not create duplicate families or children on repeated onboarding", async () => {
    const parent = await createParent();
    const first = await onboardParentWithChild(parent.user.id);
    const second = await upsertChildDuringOnboarding({
      parentUserId: parent.user.id,
      displayName: "Deniz Güncellendi",
      ageGroup: "AGE_12_14",
      timeZone: "Europe/Berlin",
    });
    const third = await upsertChildDuringOnboarding({
      parentUserId: parent.user.id,
      displayName: "Deniz Tekrar",
      ageGroup: "AGE_9_11",
      timeZone: "Europe/Istanbul",
    });

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);

    expect(await prisma.family.count()).toBe(1);
    expect(await prisma.childProfile.count()).toBe(1);
    expect(
      await prisma.familyMembership.count({
        where: { userId: parent.user.id },
      }),
    ).toBe(1);
  });

  it("redeems via HTTP route and sets a session cookie", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const { token } = await createPairingInvitation({
      parentUserId: parent.user.id,
      childId: child.id,
    });

    const res = await redeemRoute(
      request("http://localhost:3000/api/pairing/redeem", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ token }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeTruthy();
  });
});

describe("test database safety guard", () => {
  it("is connected only to gunce_test", async () => {
    const rows = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
    expect(rows[0]?.db).toBe("gunce_test");
    expect(process.env.DATABASE_URL).toContain("/gunce_test");
    expect(process.env.DATABASE_URL).not.toMatch(/\/gunce(\?|$)/);
  });
});
