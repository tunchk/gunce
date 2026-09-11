import { describe, expect, it, beforeEach } from "vitest";
import { clearCapturedMails } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import {
  acceptGuardianInvitation,
  ensureManagerAccessForChild,
  inviteGuardian,
  removeGuardianAccess,
  listActiveGuardianAccesses,
  GuardianError,
} from "@/lib/guardian";
import {
  createJournalEntry,
  listParentSharedContent,
  getParentShareDetail,
  getOrCreateParentGuidance,
  publishShare,
  updateSharingDraft,
} from "@/lib/journal";
import { getParentWeekPlan } from "@/lib/plan";
import { getParentGoals } from "@/lib/goal";
import {
  createPairingInvitation,
  revokeChildSessions as revokePairingSessions,
} from "@/lib/family";
import { AuthorizationError } from "@/lib/session";
import {
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  signInAndGetCookie,
} from "./helpers";
import { POST as postParentPlan } from "@/app/api/parent/plan/route";
import { POST as postParentGoals } from "@/app/api/parent/goals/route";

async function verifyParentEmail(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: true },
  });
}

function request(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as import("next/server").NextRequest;
}

describe("Milestone 10 multi-guardian", () => {
  beforeEach(() => {
    clearCapturedMails();
  });

  it("lets two guardians access one child; invite is child-scoped across families", async () => {
    const manager = await createParent({ email: `mgr_${Date.now()}@example.com` });
    await verifyParentEmail(manager.user.id);
    const child = await onboardParentWithChild(manager.user.id);

    const otherFamily = await createParent({
      email: `otherfam_${Date.now()}@example.com`,
    });
    await verifyParentEmail(otherFamily.user.id);
    const unrelated = await onboardParentWithChild(otherFamily.user.id);

    const invitee = await createParent({
      email: `inv_${Date.now()}@example.com`,
      password: "Invitee123!",
    });
    await verifyParentEmail(invitee.user.id);

    const { token } = await inviteGuardian({
      managerUserId: manager.user.id,
      childId: child.id,
      email: invitee.email,
    });

    await acceptGuardianInvitation({
      token,
      acceptorUserId: invitee.user.id,
    });

    const mgrAccess = await listActiveGuardianAccesses(manager.user.id);
    const invAccess = await listActiveGuardianAccesses(invitee.user.id);
    expect(mgrAccess.some((a) => a.childId === child.id)).toBe(true);
    expect(invAccess.some((a) => a.childId === child.id)).toBe(true);
    expect(invAccess.some((a) => a.childId === unrelated.id)).toBe(false);
  });

  it("INVITED cannot invite/remove guardians, manage pairing, or mutate plans/goals", async () => {
    const manager = await createParent({ email: `mgr_mut_${Date.now()}@example.com` });
    await verifyParentEmail(manager.user.id);
    const child = await onboardParentWithChild(manager.user.id);

    const invitee = await createParent({
      email: `inv_mut_${Date.now()}@example.com`,
      password: "Invitee123!",
    });
    await verifyParentEmail(invitee.user.id);
    const third = await createParent({
      email: `third_${Date.now()}@example.com`,
    });
    await verifyParentEmail(third.user.id);

    const { token } = await inviteGuardian({
      managerUserId: manager.user.id,
      childId: child.id,
      email: invitee.email,
    });
    await acceptGuardianInvitation({
      token,
      acceptorUserId: invitee.user.id,
    });

    await expect(
      inviteGuardian({
        managerUserId: invitee.user.id,
        childId: child.id,
        email: third.email,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      removeGuardianAccess({
        managerUserId: invitee.user.id,
        childId: child.id,
        targetUserId: manager.user.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      createPairingInvitation({
        parentUserId: invitee.user.id,
        childId: child.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      revokePairingSessions({
        parentUserId: invitee.user.id,
        childId: child.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const cookie = await signInAndGetCookie(invitee.email, invitee.password);
    const planMut = await postParentPlan(
      request("http://localhost:3000/api/parent/plan", {
        method: "POST",
        headers: { cookie, origin: "http://localhost:3000" },
      }),
    );
    expect(planMut.status).toBe(403);

    const goalMut = await postParentGoals(
      request("http://localhost:3000/api/parent/goals", {
        method: "POST",
        headers: { cookie, origin: "http://localhost:3000" },
      }),
    );
    expect(goalMut.status).toBe(403);
  });

  it("invite to one child grants no access to a sibling in the same family", async () => {
    const manager = await createParent({ email: `mgr_sib_${Date.now()}@example.com` });
    await verifyParentEmail(manager.user.id);
    const childA = await onboardParentWithChild(manager.user.id);

    const membership = await prisma.familyMembership.findUniqueOrThrow({
      where: { userId: manager.user.id },
    });
    const childB = await prisma.childProfile.create({
      data: {
        familyId: membership.familyId,
        displayName: "Kardeş",
        ageGroup: "AGE_9_11",
        timeZone: "Europe/Istanbul",
      },
    });
    await ensureManagerAccessForChild({
      parentUserId: manager.user.id,
      childId: childB.id,
    });

    const invitee = await createParent({
      email: `inv_sib_${Date.now()}@example.com`,
    });
    await verifyParentEmail(invitee.user.id);

    const { token } = await inviteGuardian({
      managerUserId: manager.user.id,
      childId: childA.id,
      email: invitee.email,
    });
    await acceptGuardianInvitation({
      token,
      acceptorUserId: invitee.user.id,
    });

    const access = await listActiveGuardianAccesses(invitee.user.id);
    expect(access.map((a) => a.childId).sort()).toEqual([childA.id]);

    await pairChildAndGetCookie(manager.user.id, childA.id);
    await pairChildAndGetCookie(manager.user.id, childB.id);

    const plan = await getParentWeekPlan(invitee.user.id);
    expect(plan.children.map((c) => c.childId)).toEqual([childA.id]);

    const goals = await getParentGoals(invitee.user.id);
    expect(goals.children.map((c) => c.childId)).toEqual([childA.id]);

    await expect(
      createPairingInvitation({
        parentUserId: invitee.user.id,
        childId: childB.id,
      }),
    ).rejects.toBeTruthy();
  });

  it("rejects wrong email, unverified, and concurrent accept", async () => {
    const manager = await createParent({ email: `mgr2_${Date.now()}@example.com` });
    await verifyParentEmail(manager.user.id);
    const child = await onboardParentWithChild(manager.user.id);

    const invitee = await createParent({
      email: `ok_${Date.now()}@example.com`,
    });
    await verifyParentEmail(invitee.user.id);
    const wrong = await createParent({
      email: `wrong_${Date.now()}@example.com`,
    });
    await verifyParentEmail(wrong.user.id);
    const unverified = await createParent({
      email: `unv_${Date.now()}@example.com`,
    });

    const { token } = await inviteGuardian({
      managerUserId: manager.user.id,
      childId: child.id,
      email: invitee.email,
    });

    expect(
      (await getParentWeekPlan(invitee.user.id)).children.some(
        (c) => c.childId === child.id,
      ),
    ).toBe(false);

    await expect(
      acceptGuardianInvitation({ token, acceptorUserId: wrong.user.id }),
    ).rejects.toBeInstanceOf(GuardianError);

    await expect(
      acceptGuardianInvitation({ token, acceptorUserId: unverified.user.id }),
    ).rejects.toBeInstanceOf(GuardianError);

    const [a, b] = await Promise.allSettled([
      acceptGuardianInvitation({ token, acceptorUserId: invitee.user.id }),
      acceptGuardianInvitation({ token, acceptorUserId: invitee.user.id }),
    ]);
    expect([a, b].filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("removal blocks plan, goals, share-detail, support list, and guidance", async () => {
    const manager = await createParent({ email: `mgr3_${Date.now()}@example.com` });
    await verifyParentEmail(manager.user.id);
    const child = await onboardParentWithChild(manager.user.id);
    await pairChildAndGetCookie(manager.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    const invitee = await createParent({
      email: `aud_${Date.now()}@example.com`,
    });
    await verifyParentEmail(invitee.user.id);
    const { token } = await inviteGuardian({
      managerUserId: manager.user.id,
      childId: child.id,
      email: invitee.email,
    });
    await acceptGuardianInvitation({
      token,
      acceptorUserId: invitee.user.id,
    });

    const entry = await createJournalEntry({
      childUserId,
      body: "özel",
    });
    const draft = await updateSharingDraft({
      childUserId,
      entryId: entry.id,
      parentMessage: "Herkese mesaj",
      supportRequest: "Destek lütfen",
      expectedRevision: entry.draft.revision,
    });
    await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: draft.draft.revision,
      recipientUserIds: [manager.user.id, invitee.user.id],
    });

    const before = await listParentSharedContent(invitee.user.id);
    expect(before.messages.some((m) => m.entryId === entry.id)).toBe(true);
    expect(before.supportRequests.some((m) => m.entryId === entry.id)).toBe(true);
    const shareId = before.messages.find((m) => m.entryId === entry.id)!.shareId;

    await expect(
      getParentShareDetail(invitee.user.id, shareId),
    ).resolves.toMatchObject({ shareId });

    await expect(
      getOrCreateParentGuidance({
        parentUserId: invitee.user.id,
        shareId,
        generate: async () => ({
          conversationOpener: "Merhaba",
          supportAction: "Dinle",
          provider: "test",
        }),
      }),
    ).resolves.toMatchObject({ available: true });

    expect(
      (await getParentWeekPlan(invitee.user.id)).children.some(
        (c) => c.childId === child.id,
      ),
    ).toBe(true);
    expect(
      (await getParentGoals(invitee.user.id)).children.some(
        (c) => c.childId === child.id,
      ),
    ).toBe(true);

    await removeGuardianAccess({
      managerUserId: manager.user.id,
      childId: child.id,
      targetUserId: invitee.user.id,
    });

    expect(
      (await getParentWeekPlan(invitee.user.id)).children.some(
        (c) => c.childId === child.id,
      ),
    ).toBe(false);
    expect(
      (await getParentGoals(invitee.user.id)).children.some(
        (c) => c.childId === child.id,
      ),
    ).toBe(false);

    const after = await listParentSharedContent(invitee.user.id);
    expect(after.messages.some((m) => m.entryId === entry.id)).toBe(false);
    expect(after.supportRequests.some((m) => m.entryId === entry.id)).toBe(false);

    await expect(
      getParentShareDetail(invitee.user.id, shareId),
    ).rejects.toBeTruthy();

    await expect(
      getOrCreateParentGuidance({
        parentUserId: invitee.user.id,
        shareId,
        generate: async () => ({
          conversationOpener: "Merhaba",
          supportAction: "Dinle",
          provider: "test",
        }),
      }),
    ).rejects.toBeTruthy();

    const { token: token2 } = await inviteGuardian({
      managerUserId: manager.user.id,
      childId: child.id,
      email: invitee.email,
    });
    await acceptGuardianInvitation({
      token: token2,
      acceptorUserId: invitee.user.id,
    });
    expect(
      (await getParentWeekPlan(invitee.user.id)).children.some(
        (c) => c.childId === child.id,
      ),
    ).toBe(true);
    expect(
      (await listParentSharedContent(invitee.user.id)).messages.some(
        (m) => m.entryId === entry.id,
      ),
    ).toBe(false);
  });

  it("creates MANAGER ChildGuardianAccess on onboarding", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const access = await prisma.childGuardianAccess.findFirst({
      where: { userId: parent.user.id, childId: child.id, revokedAt: null },
    });
    expect(access).toMatchObject({
      role: "MANAGER",
      generation: 1,
      revokedAt: null,
    });
    const extras = await prisma.childGuardianAccess.count({
      where: { childId: child.id, revokedAt: null },
    });
    expect(extras).toBe(1);
  });
});
