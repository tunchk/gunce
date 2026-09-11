import { test, expect } from "@playwright/test";
import {
  wipe,
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  parseCookieHeader,
} from "./fixtures";

/**
 * Simulated browser coverage for reminder settings UI.
 * Does not prove real-device or closed-app Web Push delivery.
 */
test.beforeEach(async () => {
  await wipe();
});

test("child reminders settings page loads (simulated; not real push delivery)", async ({
  browser,
}) => {
  const parent = await createParent({
    email: `e2e_remind_${Date.now()}@example.com`,
  });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);

  const ctx = await browser.newContext();
  await ctx.addCookies(parseCookieHeader(childCookie));
  const page = await ctx.newPage();

  await page.goto("/cocuk/hatirlatmalar");
  await expect(page.getByRole("heading", { name: "Hatırlatmalar" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Uygulama tercihleri")).toBeVisible();
  await expect(page.getByText("Bu cihazda bildirimleri aç")).toBeVisible();
  await expect(page.getByLabel("Günlük yazma daveti")).toBeVisible();
  await expect(page.getByLabel("Günlük yazma daveti")).toBeEnabled();

  await page.getByLabel("Günlük yazma daveti").click();
  await expect(page.getByText("Ayarlar kaydedildi.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel("Günlük yazma daveti")).toBeChecked();

  await page.goto("/cocuk/ana");
  await expect(page.getByRole("link", { name: "Hatırlatmalar" })).toBeVisible();

  await ctx.close();
});
