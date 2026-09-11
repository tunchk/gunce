import { test, expect } from "@playwright/test";
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
 * Milestone 8 — daily UX (presentation). Simulated browser coverage;
 * not a real-phone layout or microphone/push proof.
 */
test.beforeEach(async () => {
  await wipe();
});

test.use({ viewport: { width: 360, height: 740 } });

test("child nav, journal resume, and private save stay private", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_ux_child_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
    .userId!;

  const entry = await createJournalEntry({
    childUserId,
    body: "Özel günlük: bugün parkta oynadım.",
  });

  const ctx = await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
  });
  await ctx.addCookies(parseCookieHeader(childCookie));
  const page = await ctx.newPage();

  await page.goto("/cocuk/ana");
  const nav = page.getByRole("navigation", { name: "Çocuk gezinti" });
  await expect(nav.getByRole("link", { name: "Ana" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Günümü anlat" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sıradaki adımım" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bu hafta" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hatırlatmalar" })).toHaveCount(0);

  const overflowHome = await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth;
  });
  expect(overflowHome).toBeLessThanOrEqual(1);

  await nav.getByRole("link", { name: "Günlüğüm" }).click();
  await expect(page.getByRole("heading", { name: "Günlüğüm" })).toBeVisible();
  await expect(page.getByText("Bende kalacak · özel")).toBeVisible();
  await page.goto(`/cocuk/gunluk/${entry.id}`);
  await expect(page.locator("#journal-body")).toBeVisible();
  await expect(page.locator("#journal-body")).toHaveValue(/parkta oynadım/);
  await expect(page.getByRole("heading", { name: "1. Anlat / yaz" })).toBeVisible();
  await expect(page.getByText("Bende kalacak · özel")).toBeVisible();

  await page.locator("#journal-body").fill("Özel günlük: parkta oynadım ve dondurma yedim.");
  await page.getByRole("button", { name: "Kaydet (bende kalsın)" }).click();
  await expect(page.getByText("Kaydedildi")).toBeVisible({ timeout: 10_000 });

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const parentCtx = await browser.newContext();
  await parentCtx.addCookies(parseCookieHeader(parentCookie));
  const parentPage = await parentCtx.newPage();
  await parentPage.goto("/veli/ana");
  await expect(parentPage.getByText("parkta oynadım")).toHaveCount(0);
  await expect(parentPage.getByText("dondurma")).toHaveCount(0);

  const fresh = await prisma.publishedShare.findFirst({
    where: { entryId: entry.id, withdrawnAt: null },
  });
  expect(fresh).toBeNull();

  await ctx.close();
  await parentCtx.close();
});

test("home next-step matches Planım views; parent opens shares from home", async ({
  browser,
}) => {
  const parent = await createParent({ email: `e2e_ux_plan_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
    .userId!;

  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  await ctx.addCookies(parseCookieHeader(childCookie));
  const page = await ctx.newPage();

  await page.goto("/cocuk/plan/yeni");
  const notice = page.getByRole("button", { name: "Anladım" });
  if (await notice.isVisible().catch(() => false)) await notice.click();

  await page.getByRole("button", { name: "Çalışma / hazırlık adımı" }).click();
  await page.getByLabel("Kısa başlık").fill("UX sıradaki adım");
  const today = await page.evaluate(() => {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date());
  });
  await page.getByLabel("Planlanan gün (isteğe bağlı)").fill(today);
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByRole("heading", { name: "Planım" })).toBeVisible({ timeout: 15_000 });

  await page.goto("/cocuk/ana");
  await expect(page.getByText("UX sıradaki adım")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Çocuk gezinti" })
    .getByRole("link", { name: "Planım" })
    .click();
  await expect(page.getByText("UX sıradaki adım")).toBeVisible();
  await page.getByRole("tab", { name: "Pano" }).click();
  await expect(page.getByText("UX sıradaki adım").first()).toBeVisible();

  const entry = await createJournalEntry({
    childUserId,
    body: "ÖZEL destekli gün",
  });
  const draft = await updateSharingDraft({
    childUserId,
    entryId: entry.id,
    parentMessage: "",
    supportRequest: "Matematikte yardımcı olur musun?",
    expectedRevision: entry.draft.revision,
  });
  await publishShare({
    childUserId,
    entryId: entry.id,
    expectedDraftRevision: draft.draft.revision,
  });

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const parentCtx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  await parentCtx.addCookies(parseCookieHeader(parentCookie));
  const parentPage = await parentCtx.newPage();
  await parentPage.goto("/veli/ana");
  await expect(parentPage.getByText("Henüz seninle paylaşılmış bir içerik yok")).toHaveCount(0);
  await expect(parentPage.getByText("Matematikte yardımcı olur musun?")).toBeVisible();
  await expect(parentPage.getByText("ÖZEL destekli")).toHaveCount(0);
  await parentPage.getByRole("link", { name: "Paylaşım detayı" }).first().click();
  await expect(parentPage.getByText("Matematikte yardımcı olur musun?")).toBeVisible();

  const entry2 = await createJournalEntry({
    childUserId,
    body: "ÖZEL ikinci",
  });
  const draft2 = await updateSharingDraft({
    childUserId,
    entryId: entry2.id,
    parentMessage: "Bugün okul güzeldi.",
    supportRequest: "",
    expectedRevision: entry2.draft.revision,
  });
  await publishShare({
    childUserId,
    entryId: entry2.id,
    expectedDraftRevision: draft2.draft.revision,
  });
  await parentPage.goto("/veli/ana");
  await expect(parentPage.getByText("Bugün okul güzeldi.")).toBeVisible();
  await parentPage.getByRole("link", { name: "Detayı gör" }).first().click();
  await expect(parentPage.getByText("Bugün okul güzeldi.")).toBeVisible();
  await expect(parentPage.getByText("ÖZEL ikinci")).toHaveCount(0);

  await ctx.close();
  await parentCtx.close();
});
