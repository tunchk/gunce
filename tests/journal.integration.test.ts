import { describe, expect, it } from "vitest";
import { GET as listJournal, POST as createJournal } from "@/app/api/child/journal/route";
import { GET as getJournal, PATCH as patchJournal, DELETE as deleteJournal } from "@/app/api/child/journal/[id]/route";
import {
  GET as getShared,
  PATCH as patchShared,
  POST as postShared,
} from "@/app/api/parent/shared/route";
import {
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  prisma,
  request,
  signInAndGetCookie,
} from "./helpers";
import {
  createJournalEntry,
  publishShare,
  updateJournalBody,
  updateSharingDraft,
  withdrawShare,
} from "@/lib/journal";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("Journal ownership and sharing", () => {
  it("scopes journal CRUD to the authenticated child", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const cookie = await pairChildAndGetCookie(parent.user.id, child.id);

    const created = await createJournal(
      request("http://localhost:3000/api/child/journal", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          promptKey: "FREE",
          body: "Bugün parkta oynadım",
          clientRequestId: "idem-1",
        }),
      }),
    );
    expect(created.status).toBe(201);
    const { entry } = await created.json();

    const listed = await listJournal(
      request("http://localhost:3000/api/child/journal", {
        headers: { cookie, origin: "http://localhost:3000" },
      }),
    );
    expect(listed.status).toBe(200);
    const listBody = await listed.json();
    expect(listBody.entries).toHaveLength(1);
    expect(listBody.entries[0].body).toContain("parkta");

    const got = await getJournal(
      request(`http://localhost:3000/api/child/journal/${entry.id}`, {
        headers: { cookie, origin: "http://localhost:3000" },
      }),
      params(entry.id),
    );
    expect(got.status).toBe(200);
  });

  it("denies cross-child and cross-family journal access", async () => {
    const parentA = await createParent({ email: "ja@example.com" });
    const parentB = await createParent({ email: "jb@example.com" });
    const childA = await onboardParentWithChild(parentA.user.id);
    const childB = await onboardParentWithChild(parentB.user.id);
    const cookieA = await pairChildAndGetCookie(parentA.user.id, childA.id);
    const cookieB = await pairChildAndGetCookie(parentB.user.id, childB.id);

    const entryA = await createJournalEntry({
      childUserId: (await prisma.childProfile.findUniqueOrThrow({ where: { id: childA.id } })).userId!,
      promptKey: "HARD",
      body: "gizli A",
    });

    const foreignGet = await getJournal(
      request(`http://localhost:3000/api/child/journal/${entryA.id}`, {
        headers: { cookie: cookieB, origin: "http://localhost:3000" },
      }),
      params(entryA.id),
    );
    expect(foreignGet.status).toBe(404);

    const foreignPatch = await patchJournal(
      request(`http://localhost:3000/api/child/journal/${entryA.id}`, {
        method: "PATCH",
        headers: {
          cookie: cookieB,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          op: "update_body",
          body: "hack",
          expectedRevision: 1,
        }),
      }),
      params(entryA.id),
    );
    expect(foreignPatch.status).toBe(404);
    void cookieA;
  });

  it("never returns private journal text to parents, even by entry id", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;

    const entry = await createJournalEntry({
      childUserId,
      promptKey: "LIKED",
      body: "ÖZEL METİN ASLA GÖRÜNMESİN",
    });

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);

    const list = await getShared(
      request("http://localhost:3000/api/parent/shared", {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
    );
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.messages).toHaveLength(0);
    expect(listBody.supportRequests).toHaveLength(0);
    expect(JSON.stringify(listBody)).not.toContain("ÖZEL METİN");

    const byId = await getShared(
      request(`http://localhost:3000/api/parent/shared?entryId=${entry.id}`, {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
    );
    expect(byId.status).toBe(404);
    const byIdBody = await byId.json();
    expect(JSON.stringify(byIdBody)).not.toContain("ÖZEL METİN");
  });

  it("rejects parent attempts to edit shared content", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const parentCookie = await signInAndGetCookie(parent.email, parent.password);

    const patch = await patchShared(
      request("http://localhost:3000/api/parent/shared", {
        method: "PATCH",
        headers: {
          cookie: parentCookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ parentMessage: "veli düzenlemesi" }),
      }),
    );
    expect(patch.status).toBe(403);

    const post = await postShared(
      request("http://localhost:3000/api/parent/shared", {
        method: "POST",
        headers: {
          cookie: parentCookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(post.status).toBe(403);
  });

  it("private saves produce no parent-visible content", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;

    await createJournalEntry({
      childUserId,
      body: "sadece bende",
      clientRequestId: "priv-1",
    });

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    const shared = await getShared(
      request("http://localhost:3000/api/parent/shared", {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
    );
    const body = await shared.json();
    expect(body.messages).toEqual([]);
    expect(body.supportRequests).toEqual([]);
  });

  it("supports support-only sharing without a parent message", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;

    const entry = await createJournalEntry({
      childUserId,
      body: "özel günlük uzun metin",
    });
    const drafted = await updateSharingDraft({
      childUserId,
      entryId: entry.id,
      parentMessage: "",
      supportRequest: "Matematikte yardım isterim",
      expectedRevision: entry.draft.revision,
    });
    await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: drafted.draft.revision,
    });

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    const shared = await (await getShared(
      request("http://localhost:3000/api/parent/shared", {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
    )).json();

    expect(shared.messages).toHaveLength(0);
    expect(shared.supportRequests).toHaveLength(1);
    expect(shared.supportRequests[0].supportRequest).toBe("Matematikte yardım isterim");
    expect(JSON.stringify(shared)).not.toContain("özel günlük");
  });

  it("publishes an approved snapshot and keeps private edits from changing it", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;

    const entry = await createJournalEntry({
      childUserId,
      body: "özel v1",
    });
    let draft = await updateSharingDraft({
      childUserId,
      entryId: entry.id,
      parentMessage: "veli mesajı v1",
      supportRequest: "",
      expectedRevision: entry.draft.revision,
    });
    const published = await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: draft.draft.revision,
    });
    expect(published.published?.parentMessage).toBe("veli mesajı v1");

    await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "özel v2 ASLA VELİDE",
      expectedRevision: published.revision,
      markSaved: true,
    });

    draft = await updateSharingDraft({
      childUserId,
      entryId: entry.id,
      parentMessage: "veli mesajı v2 henüz yayımlanmadı",
      expectedRevision: published.draft.revision,
    });
    expect(draft.published?.parentMessage).toBe("veli mesajı v1");
    expect(draft.published?.hasUnpublishedChanges).toBe(true);

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    const shared = await (await getShared(
      request("http://localhost:3000/api/parent/shared", {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
    )).json();
    expect(shared.messages[0].parentMessage).toBe("veli mesajı v1");
    expect(JSON.stringify(shared)).not.toContain("ASLA VELİDE");
    expect(JSON.stringify(shared)).not.toContain("henüz yayımlanmadı");

    await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: draft.draft.revision,
    });

    const shared2 = await (await getShared(
      request("http://localhost:3000/api/parent/shared", {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
    )).json();
    expect(shared2.messages[0].parentMessage).toBe("veli mesajı v2 henüz yayımlanmadı");
  });

  it("withdraw and delete remove parent access", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const cookie = await pairChildAndGetCookie(parent.user.id, child.id);
    const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
      .userId!;

    const entry = await createJournalEntry({ childUserId, body: "x" });
    const draft = await updateSharingDraft({
      childUserId,
      entryId: entry.id,
      parentMessage: "görünür",
      expectedRevision: entry.draft.revision,
    });
    await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: draft.draft.revision,
    });

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    expect(
      (await (await getShared(
        request("http://localhost:3000/api/parent/shared", {
          headers: { cookie: parentCookie, origin: "http://localhost:3000" },
        }),
      )).json()).messages,
    ).toHaveLength(1);

    await withdrawShare({ childUserId, entryId: entry.id });
    expect(
      (await (await getShared(
        request("http://localhost:3000/api/parent/shared", {
          headers: { cookie: parentCookie, origin: "http://localhost:3000" },
        }),
      )).json()).messages,
    ).toHaveLength(0);

    const draft2 = await updateSharingDraft({
      childUserId,
      entryId: entry.id,
      parentMessage: "tekrar",
      expectedRevision: (await prisma.sharingDraft.findUniqueOrThrow({ where: { entryId: entry.id } }))
        .revision,
    });
    await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: draft2.draft.revision,
    });
    expect(
      (await (await getShared(
        request("http://localhost:3000/api/parent/shared", {
          headers: { cookie: parentCookie, origin: "http://localhost:3000" },
        }),
      )).json()).messages,
    ).toHaveLength(1);

    const del = await deleteJournal(
      request(`http://localhost:3000/api/child/journal/${entry.id}`, {
        method: "DELETE",
        headers: { cookie, origin: "http://localhost:3000" },
      }),
      params(entry.id),
    );
    expect(del.status).toBe(200);
    expect(
      (await (await getShared(
        request("http://localhost:3000/api/parent/shared", {
          headers: { cookie: parentCookie, origin: "http://localhost:3000" },
        }),
      )).json()).messages,
    ).toHaveLength(0);
  });

  it("is retry-safe on create and rejects stale revisions", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const cookie = await pairChildAndGetCookie(parent.user.id, child.id);

    const first = await createJournal(
      request("http://localhost:3000/api/child/journal", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ promptKey: "FREE", clientRequestId: "same-key", body: "bir" }),
      }),
    );
    const second = await createJournal(
      request("http://localhost:3000/api/child/journal", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ promptKey: "FREE", clientRequestId: "same-key", body: "iki" }),
      }),
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = await first.json();
    const b = await second.json();
    expect(a.entry.id).toBe(b.entry.id);
    expect(await prisma.journalEntry.count()).toBe(1);

    const stale = await patchJournal(
      request(`http://localhost:3000/api/child/journal/${a.entry.id}`, {
        method: "PATCH",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          op: "update_body",
          body: "stale",
          expectedRevision: 0,
        }),
      }),
      params(a.entry.id),
    );
    expect(stale.status).toBe(409);
  });

  it("publishing and withdrawal work through the journal API (private text never reaches parents)", async () => {
    const parent = await createParent();
    const child = await onboardParentWithChild(parent.user.id);
    const cookie = await pairChildAndGetCookie(parent.user.id, child.id);

    const created = await createJournal(
      request("http://localhost:3000/api/child/journal", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          promptKey: "FREE",
          body: "ÖZEL GÜNLÜK METNİ — VELİYE ASLA GİTMEZ",
          clientRequestId: "api-snapshot-1",
        }),
      }),
    );
    expect(created.status).toBe(201);
    const { entry } = await created.json();
    expect(entry.draft.revision).toBe(1);

    const updatedDraft = await patchJournal(
      request(`http://localhost:3000/api/child/journal/${entry.id}`, {
        method: "PATCH",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          op: "update_draft",
          parentMessage: "Velinin göreceği kısa not (API)",
          supportRequest: "Desteğe ihtiyacım var",
          expectedRevision: entry.draft.revision,
        }),
      }),
      params(entry.id),
    );
    expect(updatedDraft.status).toBe(200);

    const afterDraft = await updatedDraft.json();
    const expectedDraftRevision = afterDraft.entry.draft.revision;

    const published = await patchJournal(
      request(`http://localhost:3000/api/child/journal/${entry.id}`, {
        method: "PATCH",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          op: "publish",
          expectedDraftRevision,
        }),
      }),
      params(entry.id),
    );
    expect(published.status).toBe(200);

    const parentCookie = await signInAndGetCookie(parent.email, parent.password);
    const shared = await (
      await getShared(
        request("http://localhost:3000/api/parent/shared", {
          headers: { cookie: parentCookie, origin: "http://localhost:3000" },
        }),
      )
    ).json();

    expect(shared.messages).toHaveLength(1);
    expect(shared.messages[0].parentMessage).toContain("Velinin göreceği kısa not (API)");
    expect(JSON.stringify(shared)).not.toContain("ÖZEL GÜNLÜK METNİ");

    const withdrawn = await patchJournal(
      request(`http://localhost:3000/api/child/journal/${entry.id}`, {
        method: "PATCH",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ op: "withdraw" }),
      }),
      params(entry.id),
    );
    expect(withdrawn.status).toBe(200);

    const sharedAfterWithdraw = await (
      await getShared(
        request("http://localhost:3000/api/parent/shared", {
          headers: { cookie: parentCookie, origin: "http://localhost:3000" },
        }),
      )
    ).json();
    expect(sharedAfterWithdraw.messages).toEqual([]);
    expect(sharedAfterWithdraw.supportRequests).toEqual([]);
  });
});
