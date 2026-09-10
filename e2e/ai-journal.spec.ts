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

async function openFreeJournal(page: Page) {
  await page.goto("/cocuk/gunluk/yeni");
  await page.getByRole("radio", { name: "Kendim anlatacağım" }).click();
  await page.getByRole("button", { name: "Yazmaya başla" }).click();
  await expect(page.locator("#journal-body")).toBeVisible({ timeout: 15_000 });
}

test("typed entry → suggested summary → edit/accept → stays private", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_ai_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);

  const childCtx = await browser.newContext();
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const page = await childCtx.newPage();

  await openFreeJournal(page);
  const writing =
    "Bugün okulda arkadaşımla oynadım galiba. Belki yarın da görüşürüz.";
  await page.locator("#journal-body").fill(writing);
  await page.getByRole("button", { name: "Kaydet (bende kalsın)" }).click();
  await expect(page.getByText("Kaydedildi")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Yazımı toparla" }).click();
  await expect(page.getByRole("heading", { name: "Önerilen özet" })).toBeVisible({
    timeout: 15_000,
  });
  const suggestion = page.getByLabel("Önerilen özet");
  await expect(suggestion).toBeVisible();
  await suggestion.fill("Kısa düzenlenmiş özet: okulda oynadım galiba.");
  await page.getByRole("button", { name: "Özeti kabul et" }).click();
  await expect(page.getByText(/Özet kabul edildi/)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#journal-body")).toHaveValue(
    "Kısa düzenlenmiş özet: okulda oynadım galiba.",
  );

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const parentCtx = await browser.newContext();
  await parentCtx.addCookies(parseCookieHeader(parentCookie));
  const parentPage = await parentCtx.newPage();
  await parentPage.goto("/veli/ana");
  await expect(parentPage.getByText("Kısa düzenlenmiş özet")).toHaveCount(0);
  await expect(parentPage.getByText(writing)).toHaveCount(0);

  await childCtx.close();
  await parentCtx.close();
});

test("provider failure leaves writing intact", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_fail_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);

  const childCtx = await browser.newContext();
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const page = await childCtx.newPage();

  await openFreeJournal(page);
  const writing = "Kalacak metin __FAIL_SUMMARY__ ve devamı";
  await page.locator("#journal-body").fill(writing);
  await page.getByRole("button", { name: "Kaydet (bende kalsın)" }).click();
  await expect(page.getByText("Kaydedildi")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Yazımı toparla" }).click();
  await expect(page.getByText(/alınamadı|duruyor|hatası/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#journal-body")).toHaveValue(writing);

  await childCtx.close();
});

test("accepted summary shared only after explicit snapshot publish", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_share_ai_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);

  const childCtx = await browser.newContext();
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const page = await childCtx.newPage();

  await openFreeJournal(page);
  await page.locator("#journal-body").fill("ÖZEL_GİZLİ_GÜNLÜK: bugün çok yoruldum belki.");
  await page.getByRole("button", { name: "Kaydet (bende kalsın)" }).click();
  await expect(page.getByText("Kaydedildi")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Yazımı toparla" }).click();
  await expect(page.getByRole("heading", { name: "Önerilen özet" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel("Önerilen özet").fill("VELİYE_GİDEN_KISA_NOT");
  await page.getByRole("button", { name: "Özeti kabul et" }).click();
  await expect(page.getByText(/Özet kabul edildi/)).toBeVisible({ timeout: 10_000 });

  await page.getByRole("link", { name: "Paylaşımı hazırla" }).click();
  await expect(page.getByRole("button", { name: "Özetimden kopyala" })).toBeVisible();
  await page.getByRole("button", { name: "Özetimden kopyala" }).click();
  await page.getByRole("button", { name: "Paylaş", exact: true }).click();
  await expect(page.getByText(/paylaşıldı|güncellendi/i)).toBeVisible({ timeout: 10_000 });

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const parentCtx = await browser.newContext();
  await parentCtx.addCookies(parseCookieHeader(parentCookie));
  const parentPage = await parentCtx.newPage();
  await parentPage.goto("/veli/ana");
  await expect(parentPage.getByText("VELİYE_GİDEN_KISA_NOT")).toBeVisible();
  await expect(parentPage.getByText("ÖZEL_GİZLİ_GÜNLÜK")).toHaveCount(0);

  await childCtx.close();
  await parentCtx.close();
});

/**
 * Manual microphone checklist (Playwright Chromium often lacks a real mic / permission UX):
 * - [ ] Explanation visible before getUserMedia
 * - [ ] Explicit start → recording → stop / cancel / retry
 * - [ ] Auto-stop at ~120s
 * - [ ] Denied permission keeps typed input usable
 * - [ ] Tracks stop on cancel / navigate / unmount
 * - [ ] Transcript review before append/replace (no silent overwrite)
 */
test("voice UI shows mic control when test AI mode is on", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_mic_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);

  const childCtx = await browser.newContext();
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const page = await childCtx.newPage();
  await openFreeJournal(page);
  await expect(page.getByRole("button", { name: "Mikrofonla anlat" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText(/Ses, yazıya çevirmek için yapılandırılmış servise gönderilir/),
  ).toBeVisible();
  await childCtx.close();
});
