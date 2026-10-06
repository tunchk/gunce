import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  GET as getNotifications,
  PATCH as patchNotifications,
} from "@/app/api/notifications/route";
import { GET as getParentJournal } from "@/app/api/parent/journal/[entryId]/route";
import { setParentGuidanceProviderForTests, setSummarizationProviderForTests } from "@/lib/ai";
import type { ParentGuidanceProvider, SummarizationProvider } from "@/lib/ai/types";
import {
  acceptGuardianInvitation,
  inviteGuardian,
  removeGuardianAccess,
} from "@/lib/guardian";
import {
  createJournalEntry,
  deleteJournalEntry,
  getParentVisibleEntry,
  listParentVisibleEntries,
  updateJournalBody,
  updateSharingDraft,
  publishShare,
} from "@/lib/journal";
import {
  enqueueGuardianAiJob,
  processJournalAiJobs,
} from "@/lib/journal-ai";
import {
  countUnreadNotifications,
  listNotifications,
  markNotificationRead,
  notifyGuardiansOfVisibleEntry,
} from "@/lib/notifications";
import {
  createParent,
  markEntryGuardianVisible,
  markEntryLegacyPrivate,
  onboardParentWithChild,
  pairChildAndGetCookie,
  prisma,
  request,
  signInAndGetCookie,
} from "./helpers";

async function verifyParentEmail(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: true },
  });
}

function stubSummary(text = "Kısa özet"): SummarizationProvider {
  return {
    name: "test-summary",
    isConfigured: () => true,
    async summarize() {
      return { summary: text, provider: "test" };
    },
  };
}

function stubGuidance(): ParentGuidanceProvider {
  return {
    name: "test-guidance",
    isConfigured: () => true,
    async generate() {
      return {
        conversationOpener: "Bugün parkta ne oldu?",
        supportAction: "İstersen birlikte kısa bir yürüyüş planlayın.",
        provider: "test",
      };
    },
  };
}

describe("M12A journal privacy + historical GUARDIAN_VISIBLE", () => {
  beforeEach(() => {
    setSummarizationProviderForTests(stubSummary());
    setParentGuidanceProviderForTests(stubGuidance());
  });
  afterEach(() => {
    setSummarizationProviderForTests(null);
    setParentGuidanceProviderForTests(null);
  });

  it("approved share snapshots stay accessible while private body is not", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    const entry = await createJournalEntry({
      childUserId,
      body: "LEGACY_PRIVATE_SECRET",
    });
    await markEntryLegacyPrivate(entry.id);
    const draft = await updateSharingDraft({
      childUserId,
      entryId: entry.id,
      parentMessage: "Onaylı paylaşım",
      expectedRevision: 1,
    });
    await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: draft.draft.revision,
    });

    const row = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.visibility).toBe("LEGACY_PRIVATE");

    await expect(getParentVisibleEntry(parent.user.id, entry.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const visible = await listParentVisibleEntries(parent.user.id);
    expect(visible.find((v) => v.entryId === entry.id)).toBeUndefined();
    expect(JSON.stringify(visible)).not.toContain("LEGACY_PRIVATE_SECRET");
  });

  it("new save is child-private: no parent body, no notify, no guardian AI", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    const entry = await createJournalEntry({
      childUserId,
      body: "Bugün yağmurda yürüdüm",
    });
    expect(entry.visibility).toBe("LEGACY_PRIVATE");
    expect(entry.published).toBeNull();

    await expect(getParentVisibleEntry(parent.user.id, entry.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const listed = await listParentVisibleEntries(parent.user.id);
    expect(listed.find((v) => v.entryId === entry.id)).toBeUndefined();
    expect(JSON.stringify(listed)).not.toContain("yağmurda");

    expect(
      await prisma.appNotification.count({
        where: { entryId: entry.id, invalidatedAt: null },
      }),
    ).toBe(0);
    expect(await prisma.journalAiJob.count({ where: { entryId: entry.id } })).toBe(0);

    await enqueueGuardianAiJob({
      entryId: entry.id,
      sourceRevision: entry.revision,
    });
    expect(await prisma.journalAiJob.count({ where: { entryId: entry.id } })).toBe(0);

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    const api = await getParentJournal(
      request(`http://localhost:3000/api/parent/journal/${entry.id}`, {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
      { params: Promise.resolve({ entryId: entry.id }) },
    );
    expect(api.status).toBe(404);
  });

  it("empty entries produce no notifications", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    const empty = await createJournalEntry({
      childUserId,
      body: "   ",
      clientRequestId: "empty-shell",
    });
    expect(empty.body.trim()).toBe("");
    expect(
      await prisma.appNotification.count({
        where: { entryId: empty.id, invalidatedAt: null },
      }),
    ).toBe(0);
  });

  it("historical GUARDIAN_VISIBLE still notifies once per guardian and keeps read state", async () => {
    const manager = await createParent({ email: `m11a_${Date.now()}@example.com` });
    await verifyParentEmail(manager.user.id);
    const child = await onboardParentWithChild(manager.user.id);
    await pairChildAndGetCookie(manager.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    const invitee = await createParent({
      email: `m11b_${Date.now()}@example.com`,
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

    let entry = await createJournalEntry({
      childUserId,
      body: "",
      clientRequestId: "autosave-shell",
    });
    await markEntryGuardianVisible(entry.id);
    entry = await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "İlk kayıt",
      expectedRevision: entry.revision,
      markSaved: true,
    });
    entry = await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "İkinci kayıt",
      expectedRevision: entry.revision,
      markSaved: true,
    });
    await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "Üçüncü kayıt",
      expectedRevision: entry.revision,
      markSaved: true,
    });

    const notes = await prisma.appNotification.findMany({
      where: {
        entryId: entry.id,
        kind: "JOURNAL_GUARDIAN_VISIBLE",
        invalidatedAt: null,
      },
    });
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((n) => n.recipientUserId))).toEqual(
      new Set([manager.user.id, invitee.user.id]),
    );

    await markNotificationRead({
      recipientUserId: manager.user.id,
      notificationId: notes.find((n) => n.recipientUserId === manager.user.id)!.id,
    });

    await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "Dördüncü kayıt",
      expectedRevision: (
        await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } })
      ).revision,
      markSaved: true,
    });

    const after = await prisma.appNotification.findMany({
      where: { entryId: entry.id, invalidatedAt: null },
    });
    expect(after).toHaveLength(2);
    const mgr = after.find((n) => n.recipientUserId === manager.user.id)!;
    const inv = after.find((n) => n.recipientUserId === invitee.user.id)!;
    expect(mgr.readAt).not.toBeNull();
    expect(inv.readAt).toBeNull();
  });

  it("historical guardian read states are independent via notification API", async () => {
    const manager = await createParent({ email: `m11c_${Date.now()}@example.com` });
    await verifyParentEmail(manager.user.id);
    const child = await onboardParentWithChild(manager.user.id);
    await pairChildAndGetCookie(manager.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;
    const invitee = await createParent({
      email: `m11d_${Date.now()}@example.com`,
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
      body: "Bağımsız okuma",
    });
    await markEntryGuardianVisible(entry.id);
    const childRow = await prisma.childProfile.findUniqueOrThrow({
      where: { id: child.id },
    });
    await notifyGuardiansOfVisibleEntry({
      entryId: entry.id,
      childId: child.id,
      childDisplayName: childRow.displayName,
    });
    await prisma.journalEntry.update({
      where: { id: entry.id },
      data: { firstNotifiedAt: new Date() },
    });

    const noteA = await prisma.appNotification.findFirstOrThrow({
      where: { entryId: entry.id, recipientUserId: manager.user.id },
    });
    const noteB = await prisma.appNotification.findFirstOrThrow({
      where: { entryId: entry.id, recipientUserId: invitee.user.id },
    });

    const cookieA = await signInAndGetCookie(manager.email, manager.password);
    const cookieB = await signInAndGetCookie(invitee.email, invitee.password);

    const readA = await patchNotifications(
      request("http://localhost:3000/api/notifications", {
        method: "PATCH",
        headers: {
          cookie: cookieA,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ op: "read", notificationId: noteA.id }),
      }),
    );
    expect(readA.status).toBe(200);

    expect(await countUnreadNotifications(manager.user.id)).toBe(0);
    expect(await countUnreadNotifications(invitee.user.id)).toBe(1);

    const foreign = await patchNotifications(
      request("http://localhost:3000/api/notifications", {
        method: "PATCH",
        headers: {
          cookie: cookieB,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ op: "read", notificationId: noteA.id }),
      }),
    );
    expect(foreign.status).toBe(404);

    const listB = await getNotifications(
      request("http://localhost:3000/api/notifications?filter=unread", {
        headers: { cookie: cookieB, origin: "http://localhost:3000" },
      }),
    );
    const listBody = await listB.json();
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0].id).toBe(noteB.id);
    expect(JSON.stringify(listBody)).not.toContain("Bağımsız okuma");
  });

  it("access removal blocks historical visible entries and unread counts", async () => {
    const manager = await createParent({ email: `m11e_${Date.now()}@example.com` });
    await verifyParentEmail(manager.user.id);
    const child = await onboardParentWithChild(manager.user.id);
    await pairChildAndGetCookie(manager.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;
    const invitee = await createParent({
      email: `m11f_${Date.now()}@example.com`,
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
      body: "Erişim kaldırılacak",
    });
    await markEntryGuardianVisible(entry.id);
    const childRow = await prisma.childProfile.findUniqueOrThrow({
      where: { id: child.id },
    });
    await notifyGuardiansOfVisibleEntry({
      entryId: entry.id,
      childId: child.id,
      childDisplayName: childRow.displayName,
    });

    expect(await countUnreadNotifications(invitee.user.id)).toBe(1);

    await removeGuardianAccess({
      managerUserId: manager.user.id,
      childId: child.id,
      targetUserId: invitee.user.id,
    });

    expect(await countUnreadNotifications(invitee.user.id)).toBe(0);
    const listed = await listNotifications({
      recipientUserId: invitee.user.id,
      filter: "all",
    });
    expect(listed.items).toHaveLength(0);

    await expect(getParentVisibleEntry(invitee.user.id, entry.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("newly accepted guardians see historical GUARDIAN_VISIBLE only; not private bodies", async () => {
    const manager = await createParent({ email: `m11g_${Date.now()}@example.com` });
    await verifyParentEmail(manager.user.id);
    const child = await onboardParentWithChild(manager.user.id);
    await pairChildAndGetCookie(manager.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    const visible = await createJournalEntry({
      childUserId,
      body: "Tarihsel görünür",
    });
    await markEntryGuardianVisible(visible.id);
    const privateEntry = await createJournalEntry({
      childUserId,
      body: "ESKI_OZEL_METIN",
    });

    const invitee = await createParent({
      email: `m11h_${Date.now()}@example.com`,
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

    const history = await listParentVisibleEntries(invitee.user.id);
    expect(history.some((h) => h.entryId === visible.id)).toBe(true);
    expect(history.find((h) => h.entryId === visible.id)?.body).toContain("Tarihsel");
    expect(history.some((h) => h.entryId === privateEntry.id)).toBe(false);
    expect(JSON.stringify(history)).not.toContain("ESKI_OZEL_METIN");

    const flood = await prisma.appNotification.count({
      where: {
        recipientUserId: invitee.user.id,
        entryId: { in: [visible.id, privateEntry.id] },
        invalidatedAt: null,
      },
    });
    expect(flood).toBe(0);
  });

  it("stale AI on historical GUARDIAN_VISIBLE cannot overwrite current revision", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    let entry = await createJournalEntry({
      childUserId,
      body: "revizyon bir",
    });
    await markEntryGuardianVisible(entry.id);

    entry = await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "revizyon iki — güncel",
      expectedRevision: entry.revision,
      markSaved: true,
    });

    setSummarizationProviderForTests(stubSummary("GUNCEL_OZET"));
    await processJournalAiJobs({ batchSize: 20 });

    const ready = await prisma.journalGuardianAi.findUniqueOrThrow({
      where: { entryId: entry.id },
    });
    expect(ready.summaryText).toContain("GUNCEL_OZET");
    expect(ready.sourceRevision).toBe(entry.revision);

    const staleRev = entry.revision - 1;
    await prisma.journalAiJob.upsert({
      where: {
        entryId_sourceRevision: {
          entryId: entry.id,
          sourceRevision: staleRev,
        },
      },
      create: {
        entryId: entry.id,
        sourceRevision: staleRev,
        status: "PENDING",
      },
      update: {
        status: "PENDING",
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        lastError: "",
      },
    });
    setSummarizationProviderForTests(stubSummary("ESKI_OZET"));
    await processJournalAiJobs({ batchSize: 20 });

    const ai = await prisma.journalGuardianAi.findUniqueOrThrow({
      where: { entryId: entry.id },
    });
    expect(ai.sourceRevision).toBe(entry.revision);
    expect(ai.summaryText).toContain("GUNCEL_OZET");
    expect(ai.summaryText).not.toContain("ESKI_OZET");

    setSummarizationProviderForTests({
      name: "fail",
      isConfigured: () => true,
      async summarize() {
        throw new Error("boom");
      },
    });
    entry = await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "revizyon üç — hata",
      expectedRevision: entry.revision,
      markSaved: true,
    });
    await processJournalAiJobs({ batchSize: 20 });

    const detail = await getParentVisibleEntry(parent.user.id, entry.id);
    expect(detail.body).toContain("revizyon üç");
    expect(["FAILED", "PENDING", "STALE"]).toContain(detail.ai.status);
  });

  it("deleted entries cannot be resurrected by pending AI work", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    const entry = await createJournalEntry({
      childUserId,
      body: "silinecek anlatım",
    });
    await markEntryGuardianVisible(entry.id);
    await enqueueGuardianAiJob({
      entryId: entry.id,
      sourceRevision: entry.revision,
    });
    await deleteJournalEntry({ childUserId, entryId: entry.id });

    await processJournalAiJobs({ batchSize: 20 });
    expect(await prisma.journalEntry.findUnique({ where: { id: entry.id } })).toBeNull();
    expect(
      await prisma.journalGuardianAi.findUnique({ where: { entryId: entry.id } }),
    ).toBeNull();
    expect(
      await prisma.appNotification.count({
        where: { entryId: entry.id, invalidatedAt: null },
      }),
    ).toBe(0);
  });
});
