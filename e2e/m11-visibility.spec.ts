import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  wipe,
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  signInAndGetCookie,
  parseCookieHeader,
  prisma,
  markEntryLegacyPrivate,
  markEntryGuardianVisible,
  createJournalEntry,
  updateSharingDraft,
  publishShare,
} from "./fixtures";
import { updateJournalBody } from "../src/lib/journal";
import { notifyGuardiansOfVisibleEntry } from "../src/lib/notifications";

test.describe("M12A — private default + historical GUARDIAN_VISIBLE", () => {
  test.beforeEach(async () => {
    await wipe();
  });

  test("new save is private; historical visible still works for guardians", async ({
    browser,
  }) => {
    const password = "Password123!";
    const manager = await createParent({
      email: `m11_mgr_${randomBytes(3).toString("hex")}@example.com`,
      password,
    });
    await prisma.user.update({
      where: { id: manager.user.id },
      data: { emailVerified: true },
    });
    const child = await onboardParentWithChild(manager.user.id);
    const childCookie = await pairChildAndGetCookie(manager.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;

    const invitee = await createParent({
      email: `m11_inv_${randomBytes(3).toString("hex")}@example.com`,
      password,
    });
    await prisma.user.update({
      where: { id: invitee.user.id },
      data: { emailVerified: true },
    });
    const { inviteGuardian, acceptGuardianInvitation } = await import(
      "../src/lib/guardian"
    );
    const { token } = await inviteGuardian({
      managerUserId: manager.user.id,
      childId: child.id,
      email: invitee.email,
    });
    await acceptGuardianInvitation({
      token,
      acceptorUserId: invitee.user.id,
    });

    const legacy = await createJournalEntry({
      childUserId,
      body: "ESKI_OZEL_METIN_ASLA",
    });
    await markEntryLegacyPrivate(legacy.id);
    const draft = await updateSharingDraft({
      childUserId,
      entryId: legacy.id,
      parentMessage: "Onaylı legacy paylaşım",
      expectedRevision: 1,
    });
    await publishShare({
      childUserId,
      entryId: legacy.id,
      expectedDraftRevision: draft.draft.revision,
      recipientUserIds: [manager.user.id],
    });

    let privateEntry = await createJournalEntry({
      childUserId,
      body: "",
      clientRequestId: `m12-shell-${randomBytes(2).toString("hex")}`,
    });
    privateEntry = await updateJournalBody({
      childUserId,
      entryId: privateEntry.id,
      body: "Özel yeni kayıt parkta.",
      expectedRevision: privateEntry.revision,
      markSaved: true,
    });
    expect(privateEntry.visibility).toBe("LEGACY_PRIVATE");
    expect(
      await prisma.appNotification.count({
        where: { entryId: privateEntry.id, invalidatedAt: null },
      }),
    ).toBe(0);

    let entry = await createJournalEntry({
      childUserId,
      body: "Bugün parkta yağmur vardı.",
      clientRequestId: `m11-hist-${randomBytes(2).toString("hex")}`,
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
    entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } }).then(
      async () => {
        const { getChildEntry } = await import("../src/lib/journal");
        return getChildEntry(childUserId, entry.id);
      },
    );
    expect(entry.visibility).toBe("GUARDIAN_VISIBLE");
    expect(
      await prisma.appNotification.count({
        where: {
          entryId: entry.id,
          kind: "JOURNAL_GUARDIAN_VISIBLE",
          invalidatedAt: null,
        },
      }),
    ).toBe(2);

    const childCtx = await browser.newContext();
    await childCtx.addCookies(parseCookieHeader(childCookie));
    const childPage = await childCtx.newPage();
    await childPage.setViewportSize({ width: 360, height: 740 });

    await childPage.goto(`/cocuk/gunluk/${privateEntry.id}`);
    await expect(
      childPage.getByText("Yazın özel kalır. Paylaşmak istersen açık onay verirsin.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
    childPage.getByText("Paylaşımı hazırla", { exact: true }),
  ).toBeVisible();

    await childPage.goto(`/cocuk/gunluk/${entry.id}`);
    await expect(
      childPage.getByText("Bu eski kayıt velilerin görebilir modelinde.", {
        exact: true,
      }),
    ).toBeVisible();

    await childPage.goto("/cocuk/bildirimler");
    await expect(childPage.getByText(/veliye yanıt|görev gönder/i)).toHaveCount(0);

    await childPage.goto("/cocuk/plan/yeni");
    await childPage.getByRole("button", { name: "Kurs / etkinlik" }).click();
    await childPage.getByLabel("Kısa başlık").fill("Yüzme dersi");
    await childPage.getByLabel("Tarih", { exact: true }).fill("2026-09-20");
    await childPage.getByRole("button", { name: "Kaydet" }).click();
    await expect(childPage.getByText(/Kaydedildi/)).toBeVisible();
    await expect(childPage.getByRole("link", { name: "Kayda git" })).toBeVisible();

    const managerCookie = await signInAndGetCookie(manager.email, password);
    const inviteeCookie = await signInAndGetCookie(invitee.email, password);

    const mgrCtx = await browser.newContext();
    await mgrCtx.addCookies(parseCookieHeader(managerCookie));
    const mgrPage = await mgrCtx.newPage();
    await mgrPage.setViewportSize({ width: 1280, height: 800 });

    await mgrPage.goto(`/veli/gunluk/${privateEntry.id}`);
    await expect(mgrPage.getByText("Özel yeni kayıt parkta.")).toHaveCount(0);

    await mgrPage.goto("/veli/bildirimler");
    await expect(mgrPage.getByText(/gününü anlattı/i)).toBeVisible();
    await expect(mgrPage.getByText("ESKI_OZEL_METIN_ASLA")).toHaveCount(0);
    await mgrPage.locator("button", { hasText: /gününü anlattı/i }).first().click();
    await mgrPage.waitForURL(new RegExp(`/veli/gunluk/${entry.id}`));
    await expect(mgrPage.getByText("Bugün parkta yağmur vardı.")).toBeVisible();

    const invCtx = await browser.newContext();
    await invCtx.addCookies(parseCookieHeader(inviteeCookie));
    const invPage = await invCtx.newPage();
    await invPage.goto("/veli/bildirimler");
    await expect(invPage.getByText(/gününü anlattı/i).first()).toBeVisible();

    await updateJournalBody({
      childUserId,
      entryId: entry.id,
      body: "Bugün parkta yağmur vardı. Sonra eve döndüm.",
      expectedRevision: (
        await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } })
      ).revision,
      markSaved: true,
    });
    expect(
      await prisma.appNotification.count({
        where: {
          entryId: entry.id,
          kind: "JOURNAL_GUARDIAN_VISIBLE",
          invalidatedAt: null,
        },
      }),
    ).toBe(2);

    await invPage.goto(`/veli/gunluk/${entry.id}`);
    await expect(invPage.getByText("Sonra eve döndüm.")).toBeVisible();
    await expect(invPage.getByText("ESKI_OZEL_METIN_ASLA")).toHaveCount(0);

    await childCtx.close();
    await mgrCtx.close();
    await invCtx.close();
  });
});
