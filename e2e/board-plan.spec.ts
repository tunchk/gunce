import { test, expect } from "@playwright/test";
import {
  wipe,
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  parseCookieHeader,
} from "./fixtures";

test.beforeEach(async () => {
  await wipe();
});

test.use({ viewport: { width: 390, height: 844 } });

test("create step → Pano Başla → Tamamladım → Hafta agrees", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_board_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);

  const childCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const page = await childCtx.newPage();

  await page.goto("/cocuk/plan/yeni");
  const notice = page.getByRole("button", { name: "Anladım" });
  if (await notice.isVisible().catch(() => false)) await notice.click();

  await page.getByRole("button", { name: "Çalışma / hazırlık adımı" }).click();
  await page.getByLabel("Kısa başlık").fill("Pano deneme adımı");
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
  await page.getByLabel("Tahmini süre (dk, isteğe bağlı)").fill("12");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByRole("heading", { name: "Planım" })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("tab", { name: "Pano" }).click();
  await expect(page.getByRole("tab", { name: "Pano" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const mobilePanel = page.locator(".md\\:hidden");
  await expect(mobilePanel.getByText("Pano deneme adımı").first()).toBeVisible();

  await mobilePanel.getByRole("button", { name: "Başla" }).click();
  await mobilePanel.getByRole("tab", { name: /Yapıyorum/ }).click();
  await expect(mobilePanel.getByText("Pano deneme adımı").first()).toBeVisible({
    timeout: 10_000,
  });
  await mobilePanel.getByRole("button", { name: "Tamamladım" }).click();
  await mobilePanel.getByRole("tab", { name: /Tamamladım/ }).click();
  await expect(mobilePanel.getByText("Pano deneme adımı").first()).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole("tab", { name: "Hafta" }).click();
  await expect(page.getByRole("tab", { name: "Hafta" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Pano deneme adımı").first()).toBeVisible();
  await expect(page.getByText("Tamamladım").first()).toBeVisible();

  await page.getByRole("link", { name: /Pano deneme adımı/ }).first().click();
  await expect(page.getByText(/Durum: Tamamladım/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("link", { name: "Planıma dön" }).click();

  await page.getByRole("tab", { name: "Pano" }).click();
  await page.locator(".md\\:hidden").getByRole("tab", { name: /Tamamladım/ }).click();
  await expect(
    page.locator(".md\\:hidden").getByText("Pano deneme adımı").first(),
  ).toBeVisible();

  await childCtx.close();
});
