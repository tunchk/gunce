import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  wipe,
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  signInAndGetCookie,
  parseCookieHeader,
  createJournalEntry,
  updateSharingDraft,
  publishShare,
  prisma,
} from "./fixtures";

/**
 * Milestone 8.1 — authenticated visual inspection (screenshots).
 * Simulated browser widths; not a real-phone proof.
 */
test.beforeEach(async () => {
  await wipe();
});

async function assertNoOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

test("authenticated layouts at 360px and desktop (screenshots)", async ({ browser }) => {
  test.setTimeout(180_000);
  const outDir = path.join(process.cwd(), "test-results", "m81-visual");
  await mkdir(outDir, { recursive: true });

  const parent = await createParent({ email: `e2e_m81_vis_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
    .userId!;

  const longBody =
    "Bugün okulda uzun bir gün geçirdim. Matematikte kesirleri tekrar ettik, beden eğitiminde koşu yaptık ve arkadaşlarımla teneffüste basketbol oynadık. Akşam kelime çalışması da var.";
  const entry = await createJournalEntry({ childUserId, body: longBody });

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);

  const msgEntry = await createJournalEntry({ childUserId, body: "ÖZEL mesajlı" });
  const msgDraft = await updateSharingDraft({
    childUserId,
    entryId: msgEntry.id,
    parentMessage: "Bugün matematik iyi gitti, biraz yardım isterim belki.",
    supportRequest: "",
    expectedRevision: msgEntry.draft.revision,
  });
  await publishShare({
    childUserId,
    entryId: msgEntry.id,
    expectedDraftRevision: msgDraft.draft.revision,
  });

  const supportEntry = await createJournalEntry({ childUserId, body: "ÖZEL destek" });
  const supportDraft = await updateSharingDraft({
    childUserId,
    entryId: supportEntry.id,
    parentMessage: "",
    supportRequest: "Fen projesinde takıldım, birlikte bakabilir miyiz?",
    expectedRevision: supportEntry.draft.revision,
  });
  await publishShare({
    childUserId,
    entryId: supportEntry.id,
    expectedDraftRevision: supportDraft.draft.revision,
  });

  const goal = await prisma.planGoal.create({
    data: {
      childId: child.id,
      title: "Görsel hedef başlığı",
      description: "Küçük adımlarla ilerlemek",
      status: "ACTIVE",
    },
  });

  for (const [label, width, height] of [
    ["mobile", 360, 740],
    ["desktop", 1280, 900],
  ] as const) {
    const childCtx = await browser.newContext({ viewport: { width, height } });
    await childCtx.addCookies(parseCookieHeader(childCookie));
    const page = await childCtx.newPage();

    await page.goto("/cocuk/plan/yeni");
    const notice = page.getByRole("button", { name: "Anladım" });
    if (await notice.isVisible().catch(() => false)) await notice.click();
    await page.getByRole("button", { name: "Çalışma / hazırlık adımı" }).click();
    await page.getByLabel("Kısa başlık").fill("Görsel sıradaki adım");
    const today = await page.evaluate(() =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Istanbul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
    await page.getByLabel("Planlanan gün (isteğe bağlı)").fill(today);
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByRole("heading", { name: "Planım" })).toBeVisible({ timeout: 15_000 });

    await page.goto("/cocuk/ana");
    await expect(page.getByText("Görsel sıradaki adım")).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({
      path: path.join(outDir, `${label}-child-home.png`),
      fullPage: true,
    });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.screenshot({
      path: path.join(outDir, `${label}-child-home-bottom.png`),
    });

    await page.goto(`/cocuk/gunluk/${entry.id}`);
    await expect(page.locator("#journal-body")).toContainText("kesirleri");
    await expect(page.getByText("Kaydedildi").or(page.getByText("Bende kalacak"))).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({
      path: path.join(outDir, `${label}-journal-editor.png`),
      fullPage: true,
    });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const journalBottomClear = await page.evaluate(() => {
      const nav = document.querySelector(".child-nav");
      const link = Array.from(document.querySelectorAll("a")).find((a) =>
        (a.textContent || "").includes("Günlüğe dön"),
      );
      if (!nav || !link) return false;
      const navTop = nav.getBoundingClientRect().top;
      const linkBottom = link.getBoundingClientRect().bottom;
      return linkBottom <= navTop - 4;
    });
    expect(journalBottomClear, "journal footer clear of fixed nav").toBe(true);
    await page.screenshot({
      path: path.join(outDir, `${label}-journal-editor-bottom.png`),
    });

    await page.goto("/cocuk/haftam");
    await expect(page.getByText("Görsel sıradaki adım").first()).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({
      path: path.join(outDir, `${label}-plan-week.png`),
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Pano" }).click();
    await expect(page.getByText("Görsel sıradaki adım").first()).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({
      path: path.join(outDir, `${label}-plan-board.png`),
      fullPage: true,
    });

    await page.goto(`/cocuk/hedefler/${goal.id}`);
    await expect(page.getByRole("heading", { name: "Görsel hedef başlığı" })).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({
      path: path.join(outDir, `${label}-goal-detail.png`),
      fullPage: true,
    });

    await childCtx.close();

    const parentCtx = await browser.newContext({ viewport: { width, height } });
    await parentCtx.addCookies(parseCookieHeader(parentCookie));
    const parentPage = await parentCtx.newPage();
    await parentPage.goto("/veli/ana");
    await expect(
      parentPage.getByText("Bugün matematik iyi gitti, biraz yardım isterim belki."),
    ).toBeVisible();
    await expect(
      parentPage.getByText("Fen projesinde takıldım, birlikte bakabilir miyiz?"),
    ).toBeVisible();
    await assertNoOverflow(parentPage);
    await parentPage.screenshot({
      path: path.join(outDir, `${label}-parent-home.png`),
      fullPage: true,
    });
    await parentPage.getByRole("link", { name: "Detayı gör" }).first().click();
    await expect(
      parentPage.getByText("Bugün matematik iyi gitti, biraz yardım isterim belki."),
    ).toBeVisible();
    await assertNoOverflow(parentPage);
    await parentPage.screenshot({
      path: path.join(outDir, `${label}-parent-share-detail.png`),
      fullPage: true,
    });
    await parentCtx.close();
  }
});
