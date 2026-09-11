import { test, expect, type Page } from "@playwright/test";
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

async function fridayIsoFromPage(page: Page): Promise<string> {
  // Derive Friday of the child's current week from Europe/Istanbul calendar.
  return page.evaluate(() => {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const today = fmt.format(new Date());
    const [y, m, d] = today.split("-").map(Number);
    const utc = new Date(Date.UTC(y!, m! - 1, d!));
    const dow = utc.getUTCDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    utc.setUTCDate(utc.getUTCDate() + mondayOffset + 4);
    return utc.toISOString().slice(0, 10);
  });
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test.use({ viewport: { width: 390, height: 844 } });

test("exam → prep steps → complete/reschedule → parent read-only", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_plan_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);

  const childCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const page = await childCtx.newPage();

  await page.goto("/cocuk/ana");
  await expect(page.getByRole("heading", { name: "Günümü anlat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Haftama bak" })).toBeVisible();

  await page.getByRole("button", { name: "Plan ekle" }).click();
  await expect(page.getByRole("heading", { name: "Plan ekle" })).toBeVisible();

  // Dismiss parent notice if shown
  const notice = page.getByRole("button", { name: "Anladım" });
  if (await notice.isVisible().catch(() => false)) {
    await notice.click();
  }

  await page.getByRole("button", { name: "Sınav" }).click();
  const friday = await fridayIsoFromPage(page);
  const wednesday = addDays(friday, -2);
  const thursday = addDays(friday, -1);

  await page.getByLabel("Kısa başlık").fill("Almanca kelime sınavı");
  await page.getByLabel("Tarih").fill(friday);
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(/Hazırlık adımı eklemek ister misin/)).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Evet, adım ekle" }).click();

  await page.getByLabel("Kısa başlık").fill("5 kelimeyi tekrar et");
  await page.getByLabel("Planlanan gün (isteğe bağlı)").fill(wednesday);
  await page.getByLabel("Tahmini süre (dk, isteğe bağlı)").fill("10");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByRole("heading", { name: "Haftam" })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Plan ekle" }).click();
  await page.getByRole("button", { name: "Çalışma / hazırlık adımı" }).click();
  await page.getByLabel("Kısa başlık").fill("Kendimi dene");
  await page.getByLabel("Planlanan gün (isteğe bağlı)").fill(thursday);
  await page.getByLabel("Tahmini süre (dk, isteğe bağlı)").fill("15");
  await page.getByLabel("Bağlı ödev / sınav (isteğe bağlı)").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByRole("heading", { name: "Haftam" })).toBeVisible({ timeout: 15_000 });

  // Open Wednesday step via day selector — weekday short labels
  await page.getByRole("button").filter({ hasText: "Çar" }).nth(0).click();
  await page.getByRole("link", { name: /5 kelimeyi tekrar et/ }).first().click();
  await page.getByRole("button", { name: "Tamamladım" }).click();
  await expect(page.getByText("Durum: Tamamladım")).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole("link", { name: "Haftama dön" }).click();
  await page.getByRole("button").filter({ hasText: "Per" }).nth(0).click();
  await page.getByRole("link", { name: /Kendimi dene/ }).first().click();
  await page.getByLabel("Planlanan gün").fill(friday);
  await page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(page.getByText(/Kaydedilemedi|Bağlantı/)).toHaveCount(0);
  await page.getByRole("link", { name: "Haftama dön" }).click();

  // Exam still Friday — open Cum day and find exam
  await page.getByRole("button").filter({ hasText: "Cum" }).nth(0).click();
  await expect(page.getByRole("link", { name: /Sınav.*Almanca kelime sınavı/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Kendimi dene/ })).toBeVisible();

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const parentCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await parentCtx.addCookies(parseCookieHeader(parentCookie));
  const parentPage = await parentCtx.newPage();
  await parentPage.goto("/veli/ana");
  await expect(parentPage.getByRole("heading", { name: "Haftanın planı" })).toBeVisible();
  await parentPage.getByRole("button", { name: "Haftanın planını aç" }).click();
  await expect(parentPage.getByRole("heading", { name: "Haftanın planı" })).toBeVisible();
  await expect(parentPage.getByText("7 Eyl Pzt", { exact: false })).toBeVisible({ timeout: 10_000 });
  await parentPage.getByRole("button").filter({ hasText: "Cum" }).nth(0).click();
  await expect(parentPage.getByText("Almanca kelime sınavı").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(parentPage.getByText("Kendimi dene").first()).toBeVisible();
  await expect(parentPage.getByRole("button", { name: "Plan ekle" })).toHaveCount(0);
  await expect(parentPage.getByRole("button", { name: "Tamamladım" })).toHaveCount(0);
  await expect(parentPage.getByRole("link", { name: /Almanca kelime sınavı/ })).toHaveCount(0);

  await childCtx.close();
  await parentCtx.close();
});
