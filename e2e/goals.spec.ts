import { test, expect } from "@playwright/test";
import {
  wipe,
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  signInAndGetCookie,
  parseCookieHeader,
} from "./fixtures";

test.beforeEach(async () => {
  await wipe();
});

test.use({ viewport: { width: 390, height: 844 } });

test("goal → steps → complete on Pano → progress → parent read-only", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_goal_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);

  const childCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const page = await childCtx.newPage();

  await page.goto("/cocuk/hedefler/yeni");
  const notice = page.getByRole("button", { name: "Anladım" });
  if (await notice.isVisible().catch(() => false)) await notice.click();

  await page.getByLabel("Hedef başlığı").fill("Almancada 40 yeni kelime öğrenmek");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(/İlk küçük adımını eklemek ister misin/)).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Evet, adım ekle" }).click();

  await page.getByLabel("Adım başlığı").fill("İlk 5 kelimeyi seç");
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
  await page.getByRole("button", { name: "Adımı kaydet" }).click();
  await expect(page.getByText("0 / 1 adım tamamlandı")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Yeni adım ekle" }).click();
  await page.getByLabel("Adım başlığı").fill("Kelimeleri cümlede kullan");
  await page.getByRole("button", { name: "Adımı kaydet" }).click();
  await expect(page.getByText("0 / 2 adım tamamlandı")).toBeVisible({ timeout: 10_000 });

  await page.goto("/cocuk/haftam?view=pano");
  await expect(page.getByRole("tab", { name: "Pano" })).toHaveAttribute("aria-selected", "true");
  const mobilePanel = page.locator(".md\\:hidden").first();
  await mobilePanel.getByRole("tab", { name: /Yapılacak/ }).click();

  const todoCard = mobilePanel.locator("article").filter({ hasText: "İlk 5 kelimeyi seç" });
  await expect(todoCard).toBeVisible({ timeout: 10_000 });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/child/plan/step/") &&
        r.request().method() === "PATCH" &&
        r.ok(),
    ),
    todoCard.getByRole("button", { name: "Başla" }).click(),
  ]);

  await mobilePanel.getByRole("tab", { name: /Yapıyorum/ }).click();
  const doingCard = mobilePanel.locator("article").filter({ hasText: "İlk 5 kelimeyi seç" });
  await expect(doingCard).toBeVisible({ timeout: 10_000 });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/child/plan/step/") &&
        r.request().method() === "PATCH" &&
        r.ok(),
    ),
    doingCard.getByRole("button", { name: "Tamamladım" }).click(),
  ]);

  await mobilePanel.getByRole("tab", { name: /Tamamladım/ }).click();
  await expect(
    mobilePanel.locator("article").filter({ hasText: "İlk 5 kelimeyi seç" }),
  ).toBeVisible({ timeout: 10_000 });

  await page.goto("/cocuk/hedefler");
  await expect(page.getByText("1 / 2 adım tamamlandı")).toBeVisible({ timeout: 10_000 });

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const parentCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await parentCtx.addCookies(parseCookieHeader(parentCookie));
  const parentPage = await parentCtx.newPage();
  await parentPage.goto("/veli/hedefler");
  await expect(parentPage.getByText("Almancada 40 yeni kelime öğrenmek")).toBeVisible({
    timeout: 10_000,
  });
  await expect(parentPage.getByText("1 / 2 adım tamamlandı")).toBeVisible();
  await expect(parentPage.getByRole("button", { name: "Yeni hedef" })).toHaveCount(0);
  await expect(parentPage.getByRole("button", { name: "Hedefime ulaştım" })).toHaveCount(0);

  await childCtx.close();
  await parentCtx.close();
});
