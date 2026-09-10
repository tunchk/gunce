import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { POST as guidanceRoute, GET as detailRoute } from "@/app/api/parent/shared/[shareId]/route";
import { GET as listShared } from "@/app/api/parent/shared/route";
import { setParentGuidanceProviderForTests } from "@/lib/ai";
import { ProviderError, type ParentGuidanceProvider } from "@/lib/ai/types";
import {
  createJournalEntry,
  getOrCreateParentGuidance,
  publishShare,
  updateSharingDraft,
  withdrawShare,
  deleteJournalEntry,
} from "@/lib/journal";
import { prisma } from "@/lib/prisma";
import {
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  request,
  signInAndGetCookie,
} from "./helpers";

function params(shareId: string) {
  return { params: Promise.resolve({ shareId }) };
}

let lastGuidanceInput: { parentMessage: string; supportRequest: string } | null = null;

function stubGuidance(
  opener = "Hangi adımda takıldığını bana göstermek ister misin?",
  action = "İsterse birlikte tek bir örnek çözmek için kısa bir zaman ayırabilirsiniz.",
): ParentGuidanceProvider {
  return {
    name: "test-parent-guidance",
    isConfigured: () => true,
    async generate(input) {
      lastGuidanceInput = {
        parentMessage: input.parentMessage,
        supportRequest: input.supportRequest,
      };
      if (input.parentMessage.includes("__FAIL_GUIDANCE__")) {
        throw new ProviderError("fail", "PROVIDER_FAILURE");
      }
      return { conversationOpener: opener, supportAction: action, provider: "test" };
    },
  };
}

describe("Parent share detail + guidance", () => {
  beforeEach(() => {
    lastGuidanceInput = null;
    setParentGuidanceProviderForTests(stubGuidance());
  });
  afterEach(() => {
    setParentGuidanceProviderForTests(null);
  });

  async function publishConcrete(message: string, support = "") {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;
    const entry = await createJournalEntry({
      childUserId,
      body: "ÖZEL_GİZLİ_GÜNLÜK_METNİ asla veliye gitmemeli",
    });
    const draft = await updateSharingDraft({
      childUserId,
      entryId: entry.id,
      parentMessage: message,
      supportRequest: support,
      expectedRevision: entry.draft.revision,
    });
    await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: draft.draft.revision,
    });
    const share = await prisma.publishedShare.findUniqueOrThrow({ where: { entryId: entry.id } });
    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    return { parent, childUserId, entry, share, parentCookie, message };
  }

  it("shows the approved message on list and full detail (not a category placeholder)", async () => {
    const concrete = "Kesirlerde paydaları eşitlemeyi anlamadım.";
    const { share, parentCookie, message } = await publishConcrete(concrete);

    const list = await (
      await listShared(
        request("http://localhost:3000/api/parent/shared", {
          headers: { cookie: parentCookie, origin: "http://localhost:3000" },
        }),
      )
    ).json();
    expect(list.messages[0].parentMessage).toBe(concrete);
    expect(JSON.stringify(list)).not.toContain("ÖZEL_GİZLİ");
    expect(JSON.stringify(list)).not.toContain("Zorlandığım bir şey");

    const detail = await detailRoute(
      request(`http://localhost:3000/api/parent/shared/${share.id}`, {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
      params(share.id),
    );
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.share.parentMessage).toBe(message);
    expect(body.share.parentMessage).not.toContain("ÖZEL_GİZLİ");
  });

  it("does not expand a short published message with private journal text", async () => {
    const short = "Zorlandığım bir durumu anlattım.";
    const { share, parentCookie, entry } = await publishConcrete(short);

    const res = await detailRoute(
      request(`http://localhost:3000/api/parent/shared/${share.id}`, {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
      params(share.id),
    );
    const data = await res.json();
    expect(data.share.parentMessage).toBe(short);
    expect(JSON.stringify(data)).not.toContain("ÖZEL_GİZLİ");

    const privateEntry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(privateEntry.body).toContain("ÖZEL_GİZLİ");
  });

  it("generates guidance without an explicit support request", async () => {
    const { share, parentCookie } = await publishConcrete(
      "Kesirlerde paydaları eşitlemeyi anlamadım.",
    );
    const res = await guidanceRoute(
      request(`http://localhost:3000/api/parent/shared/${share.id}`, {
        method: "POST",
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
      params(share.id),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.guidance.available).toBe(true);
    expect(data.guidance.conversationOpener.length).toBeGreaterThan(5);
    expect(data.guidance.label).toContain("AI önerisi");
  });

  it("sends only authorized published content to the guidance provider", async () => {
    const { share, parentCookie } = await publishConcrete(
      "Kesirlerde paydaları eşitlemeyi anlamadım.",
      "Birlikte bakabilir miyiz?",
    );
    await guidanceRoute(
      request(`http://localhost:3000/api/parent/shared/${share.id}`, {
        method: "POST",
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
      params(share.id),
    );
    expect(lastGuidanceInput?.parentMessage).toBe("Kesirlerde paydaları eşitlemeyi anlamadım.");
    expect(lastGuidanceInput?.supportRequest).toBe("Birlikte bakabilir miyiz?");
    expect(JSON.stringify(lastGuidanceInput)).not.toContain("ÖZEL_GİZLİ");
  });

  it("denies cross-family access to detail and guidance", async () => {
    const { share } = await publishConcrete("Aile A mesajı");
    const other = await createParent({ email: `other_${Date.now()}@example.com` });
    await onboardParentWithChild(other.user.id);
    const otherCookie = await signInAndGetCookie(other.email, other.password);

    const detail = await detailRoute(
      request(`http://localhost:3000/api/parent/shared/${share.id}`, {
        headers: { cookie: otherCookie, origin: "http://localhost:3000" },
      }),
      params(share.id),
    );
    expect(detail.status).toBe(404);

    const guidance = await guidanceRoute(
      request(`http://localhost:3000/api/parent/shared/${share.id}`, {
        method: "POST",
        headers: { cookie: otherCookie, origin: "http://localhost:3000" },
      }),
      params(share.id),
    );
    expect(guidance.status).toBe(404);
  });

  it("invalidates guidance on republish", async () => {
    const { share, parentCookie, childUserId, entry } = await publishConcrete(
      "İlk paylaşılan mesaj",
    );
    await guidanceRoute(
      request(`http://localhost:3000/api/parent/shared/${share.id}`, {
        method: "POST",
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
      params(share.id),
    );
    const before = await prisma.parentGuidance.findUniqueOrThrow({ where: { shareId: share.id } });

    const draft = await updateSharingDraft({
      childUserId,
      entryId: entry.id,
      parentMessage: "Güncellenmiş paylaşılan mesaj",
      supportRequest: "",
      expectedRevision: (
        await prisma.sharingDraft.findUniqueOrThrow({ where: { entryId: entry.id } })
      ).revision,
    });
    await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: draft.draft.revision,
    });

    expect(await prisma.parentGuidance.findUnique({ where: { shareId: share.id } })).toBeNull();

    setParentGuidanceProviderForTests(stubGuidance("Yeni açıcı", "Yeni adım"));
    const again = await guidanceRoute(
      request(`http://localhost:3000/api/parent/shared/${share.id}`, {
        method: "POST",
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
      params(share.id),
    );
    const data = await again.json();
    expect(data.guidance.conversationOpener).toBe("Yeni açıcı");
    expect(data.guidance.snapshotRevision).not.toBe(before.snapshotRevision);
  });

  it("withdrawal blocks access; mid-flight delete does not store guidance", async () => {
    const { share, parentCookie, childUserId, entry, parent } = await publishConcrete(
      "Çekilmeden önce",
    );

    await withdrawShare({ childUserId, entryId: entry.id });
    const afterWithdraw = await detailRoute(
      request(`http://localhost:3000/api/parent/shared/${share.id}`, {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
      params(share.id),
    );
    expect(afterWithdraw.status).toBe(404);

    const draft = await updateSharingDraft({
      childUserId,
      entryId: entry.id,
      parentMessage: "Yeniden yayın",
      expectedRevision: (
        await prisma.sharingDraft.findUniqueOrThrow({ where: { entryId: entry.id } })
      ).revision,
    });
    await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: draft.draft.revision,
    });
    const liveShare = await prisma.publishedShare.findUniqueOrThrow({
      where: { entryId: entry.id },
    });

    await expect(
      getOrCreateParentGuidance({
        parentUserId: parent.user.id,
        shareId: liveShare.id,
        generate: async () => {
          await deleteJournalEntry({ childUserId, entryId: entry.id });
          return {
            conversationOpener: "Hayalet",
            supportAction: "Yok",
            provider: "test",
          };
        },
      }),
    ).rejects.toMatchObject({ code: "GONE" });

    expect(await prisma.parentGuidance.count()).toBe(0);
  });

  it("missing AI config still allows reading the share detail", async () => {
    const { share, parentCookie } = await publishConcrete("Okunabilir mesaj");
    setParentGuidanceProviderForTests({
      name: "off",
      isConfigured: () => false,
      async generate() {
        throw new ProviderError("off", "NOT_CONFIGURED");
      },
    });

    const detail = await detailRoute(
      request(`http://localhost:3000/api/parent/shared/${share.id}`, {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
      params(share.id),
    );
    expect(detail.status).toBe(200);
    expect((await detail.json()).share.parentMessage).toBe("Okunabilir mesaj");

    const guidance = await guidanceRoute(
      request(`http://localhost:3000/api/parent/shared/${share.id}`, {
        method: "POST",
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
      params(share.id),
    );
    expect(guidance.status).toBe(200);
    expect((await guidance.json()).guidance.available).toBe(false);
  });
});
