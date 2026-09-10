import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { POST as summarizeRoute } from "@/app/api/child/journal/[id]/summarize/route";
import { POST as transcribeRoute } from "@/app/api/child/journal/[id]/transcribe/route";
import { PATCH as patchJournal } from "@/app/api/child/journal/[id]/route";
import { GET as getShared } from "@/app/api/parent/shared/route";
import {
  setSummarizationProviderForTests,
  setTranscriptionProviderForTests,
} from "@/lib/ai";
import { ProviderError, type SummarizationProvider, type TranscriptionProvider } from "@/lib/ai/types";
import {
  acceptSummarySuggestion,
  createJournalEntry,
  createSummarySuggestion,
  updateJournalBody,
  updateSharingDraft,
  publishShare,
} from "@/lib/journal";
import {
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  prisma,
  request,
  signInAndGetCookie,
} from "./helpers";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function stubTranscription(text = "Sesli metin denemesi"): TranscriptionProvider {
  return {
    name: "test-transcription",
    isConfigured: () => true,
    async transcribe() {
      return { text, provider: "test" };
    },
  };
}

function stubSummarization(summary = "Kısa önerilen özet"): SummarizationProvider {
  return {
    name: "test-summarization",
    isConfigured: () => true,
    async summarize() {
      return { summary, provider: "test" };
    },
  };
}

describe("Voice + AI summary (Milestone 3)", () => {
  beforeEach(() => {
    setTranscriptionProviderForTests(stubTranscription());
    setSummarizationProviderForTests(stubSummarization());
  });

  afterEach(() => {
    setTranscriptionProviderForTests(null);
    setSummarizationProviderForTests(null);
  });

  it("denies unauthorized and cross-child access to summarize/transcribe", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;
    const entry = await createJournalEntry({ childUserId, body: "merhaba" });

    const unauth = await summarizeRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/summarize`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ expectedRevision: entry.revision }),
      }),
      params(entry.id),
    );
    expect(unauth.status).toBe(401);

    const parentB = await createParent({ email: "other@example.com" });
    const childB = await onboardParentWithChild(parentB.user.id);
    const cookieB = await pairChildAndGetCookie(parentB.user.id, childB.id);

    const cross = await summarizeRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/summarize`, {
        method: "POST",
        headers: {
          cookie: cookieB,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ expectedRevision: 1 }),
      }),
      params(entry.id),
    );
    expect(cross.status).toBe(404);
  });

  it("parents cannot access private transcripts or suggestions", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;
    const entry = await createJournalEntry({
      childUserId,
      body: "ÖZEL TRANSKRİPT VE ÖZET",
    });
    await createSummarySuggestion({
      childUserId,
      entryId: entry.id,
      requestId: "req-priv-1",
      expectedRevision: entry.revision,
      suggestedText: "ÖZEL ÖNERİ METNİ",
    });

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    const shared = await (
      await getShared(
        request("http://localhost:3000/api/parent/shared", {
          headers: { cookie: parentCookie, origin: "http://localhost:3000" },
        }),
      )
    ).json();
    expect(JSON.stringify(shared)).not.toContain("ÖZEL");
    expect(shared.messages).toEqual([]);
  });

  it("rejects empty/unsupported/oversized audio and missing config", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const cookie = await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;
    const entry = await createJournalEntry({ childUserId, body: "x" });

    setTranscriptionProviderForTests({
      name: "off",
      isConfigured: () => false,
      async transcribe() {
        throw new ProviderError("yok", "NOT_CONFIGURED");
      },
    });

    const form = new FormData();
    form.append("audio", new File([new Uint8Array([1, 2, 3])], "a.webm", { type: "audio/webm" }));
    form.append("expectedRevision", String(entry.revision));

    const missing = await transcribeRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/transcribe`, {
        method: "POST",
        headers: { cookie, origin: "http://localhost:3000" },
        body: form,
      }) as never,
      params(entry.id),
    );
    expect(missing.status).toBe(503);

    setTranscriptionProviderForTests(stubTranscription());
    const empty = new FormData();
    empty.append("audio", new File([], "a.webm", { type: "audio/webm" }));
    empty.append("expectedRevision", String(entry.revision));
    const emptyRes = await transcribeRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/transcribe`, {
        method: "POST",
        headers: { cookie, origin: "http://localhost:3000" },
        body: empty,
      }) as never,
      params(entry.id),
    );
    expect(emptyRes.status).toBe(400);

    const badType = new FormData();
    badType.append("audio", new File([new Uint8Array([1])], "a.txt", { type: "text/plain" }));
    badType.append("expectedRevision", String(entry.revision));
    const badRes = await transcribeRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/transcribe`, {
        method: "POST",
        headers: { cookie, origin: "http://localhost:3000" },
        body: badType,
      }) as never,
      params(entry.id),
    );
    expect(badRes.status).toBe(400);

    const oversized = new FormData();
    oversized.append(
      "audio",
      new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.webm", { type: "audio/webm" }),
    );
    oversized.append("expectedRevision", String(entry.revision));
    const bigRes = await transcribeRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/transcribe`, {
        method: "POST",
        headers: { cookie, origin: "http://localhost:3000" },
        body: oversized,
      }) as never,
      params(entry.id),
    );
    expect(bigRes.status).toBe(400);
  });

  it("handles provider timeout/failure and invalid summary output", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const cookie = await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;
    const entry = await createJournalEntry({ childUserId, body: "uzun bir metin" });

    setSummarizationProviderForTests({
      name: "fail",
      isConfigured: () => true,
      async summarize() {
        throw new ProviderError("timeout", "TIMEOUT");
      },
    });
    const timeout = await summarizeRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/summarize`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ expectedRevision: entry.revision }),
      }),
      params(entry.id),
    );
    expect(timeout.status).toBe(504);

    setSummarizationProviderForTests({
      name: "bad",
      isConfigured: () => true,
      async summarize() {
        throw new ProviderError("bad", "INVALID_OUTPUT");
      },
    });
    const invalid = await summarizeRoute(
      request(`http://localhost:3000/api/child/journal/${entry.id}/summarize`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ expectedRevision: entry.revision }),
      }),
      params(entry.id),
    );
    expect(invalid.status).toBe(502);

    // Original body preserved
    const still = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(still.body).toBe("uzun bir metin");
  });

  it("preserves original, marks stale suggestions, and does not publish on accept", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;

    let entry = await createJournalEntry({
      childUserId,
      body: "Orijinal uzun yazı galiba",
    });
    entry = await createSummarySuggestion({
      childUserId,
      entryId: entry.id,
      requestId: "sum-1",
      expectedRevision: entry.revision,
      suggestedText: "Kısa özet",
    });
    expect(entry.latestSuggestion?.suggestedText).toBe("Kısa özet");

    entry = await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "Orijinal uzun yazı galiba — düzenlendi",
      expectedRevision: entry.revision,
      markSaved: true,
    });
    expect(entry.latestSuggestion?.status).toBe("STALE");

    entry = await createSummarySuggestion({
      childUserId,
      entryId: entry.id,
      requestId: "sum-2",
      expectedRevision: entry.revision,
      suggestedText: "Yeni kısa özet",
    });
    entry = await acceptSummarySuggestion({
      childUserId,
      entryId: entry.id,
      suggestionId: entry.latestSuggestion!.id,
      expectedRevision: entry.revision,
      editedText: "Kabul edilen özet",
    });
    expect(entry.body).toBe("Kabul edilen özet");
    expect(entry.originalBody).toContain("Orijinal");
    expect(entry.acceptedSummary).toBe("Kabul edilen özet");

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    const shared = await (
      await getShared(
        request("http://localhost:3000/api/parent/shared", {
          headers: { cookie: parentCookie, origin: "http://localhost:3000" },
        }),
      )
    ).json();
    expect(shared.messages).toEqual([]);
  });

  it("rejects late suggestion when source revision changed", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;
    const entry = await createJournalEntry({ childUserId, body: "v1" });
    await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "v2",
      expectedRevision: entry.revision,
    });

    await expect(
      createSummarySuggestion({
        childUserId,
        entryId: entry.id,
        requestId: "late-1",
        expectedRevision: entry.revision, // stale
        suggestedText: "geç kaldı",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("explicit copy to sharing draft then publish shows only approved snapshot", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;
    let entry = await createJournalEntry({
      childUserId,
      body: "Özel günlük",
    });
    entry = await createSummarySuggestion({
      childUserId,
      entryId: entry.id,
      requestId: "pub-1",
      expectedRevision: entry.revision,
      suggestedText: "Özet metin",
    });
    entry = await acceptSummarySuggestion({
      childUserId,
      entryId: entry.id,
      suggestionId: entry.latestSuggestion!.id,
      expectedRevision: entry.revision,
    });

    const draft = await updateSharingDraft({
      childUserId,
      entryId: entry.id,
      parentMessage: entry.acceptedSummary,
      expectedRevision: entry.draft.revision,
    });
    await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: draft.draft.revision,
    });

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    const shared = await (
      await getShared(
        request("http://localhost:3000/api/parent/shared", {
          headers: { cookie: parentCookie, origin: "http://localhost:3000" },
        }),
      )
    ).json();
    expect(shared.messages[0].parentMessage).toBe("Özet metin");
    expect(JSON.stringify(shared)).not.toContain("Özel günlük");
  });

  it("does not recreate content when entry is deleted during in-flight summary", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;
    const entry = await createJournalEntry({ childUserId, body: "silinecek" });

    await prisma.journalEntry.delete({ where: { id: entry.id } });

    await expect(
      createSummarySuggestion({
        childUserId,
        entryId: entry.id,
        requestId: "gone-1",
        expectedRevision: entry.revision,
        suggestedText: "hayalet",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await prisma.journalSuggestion.count()).toBe(0);
  });

  it("accept_suggestion via API leaves parent feed empty until publish", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const cookie = await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;
    let entry = await createJournalEntry({ childUserId, body: "kaynak" });
    entry = await createSummarySuggestion({
      childUserId,
      entryId: entry.id,
      requestId: "api-acc",
      expectedRevision: entry.revision,
      suggestedText: "özet",
    });

    const accepted = await patchJournal(
      request(`http://localhost:3000/api/child/journal/${entry.id}`, {
        method: "PATCH",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          op: "accept_suggestion",
          suggestionId: entry.latestSuggestion!.id,
          expectedRevision: entry.revision,
        }),
      }),
      params(entry.id),
    );
    expect(accepted.status).toBe(200);

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    const shared = await (
      await getShared(
        request("http://localhost:3000/api/parent/shared", {
          headers: { cookie: parentCookie, origin: "http://localhost:3000" },
        }),
      )
    ).json();
    expect(shared.messages).toEqual([]);
  });
});
