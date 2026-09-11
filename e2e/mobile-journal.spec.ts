import { test, expect, type Page } from "@playwright/test";
import {
  wipe,
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  parseCookieHeader,
} from "./fixtures";

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

async function openFreeJournal(page: Page) {
  await page.goto("/cocuk/gunluk/yeni");
  await page.getByRole("radio", { name: "Kendim anlatacağım" }).click();
  await page.getByRole("button", { name: "Yazmaya başla" }).click();
  await expect(page.locator("#journal-body")).toBeVisible({ timeout: 15_000 });
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return {
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      clientWidth: doc.clientWidth,
    };
  });
  expect(
    overflow.scrollWidth,
    `horizontal overflow: scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function assertComfortableTargets(page: Page, names: string[]) {
  for (const name of names) {
    const btn = page.getByRole("button", { name });
    if (!(await btn.isVisible().catch(() => false))) continue;
    const box = await btn.boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
  }
}

test.beforeEach(async () => {
  await wipe();
});

for (const vp of VIEWPORTS) {
  test(`child journal journey layout @ ${vp.width}px`, async ({ browser }) => {
    const parent = await createParent({
      email: `e2e_mobile_${vp.width}_${Date.now()}@example.com`,
    });
    const child = await onboardParentWithChild(parent.user.id);
    const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);

    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: true,
      hasTouch: true,
    });
    await context.addCookies(parseCookieHeader(childCookie));
    const page = await context.newPage();

    await openFreeJournal(page);
    await assertNoHorizontalOverflow(page);

    const writing =
      "Bugün basketbolda güzel bir pas verdim. Matematikte bir soruyu anlayamadım. Galiba cuma günü kelime sınavı var ama öğretmene tekrar soracağım.";
    await page.locator("#journal-body").fill(writing);
    await assertComfortableTargets(page, [
      "Mikrofonla anlat",
      "Yazımı toparla",
      "Kaydet (bende kalsın)",
    ]);

    // Cancel path must not wipe typed text (simulate leaving review idle after mic cancel UI).
    await expect(page.locator("#journal-body")).toHaveValue(writing);

    await page.getByRole("button", { name: "Kaydet (bende kalsın)" }).click();
    await expect(page.getByText("Kaydedildi")).toBeVisible({ timeout: 10_000 });
    await assertNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Yazımı toparla" }).click();
    await expect(page.getByRole("heading", { name: "Önerilen özet" })).toBeVisible({
      timeout: 15_000,
    });
    await assertNoHorizontalOverflow(page);
    await assertComfortableTargets(page, [
      "Özeti kabul et",
      "Öneriyi sil",
      "Yeniden öner",
      "Kaydet (bende kalsın)",
    ]);

    // Failure-style discard keeps original writing in the main field until accept.
    await expect(page.locator("#journal-body")).toHaveValue(writing);
    await page.getByRole("button", { name: "Öneriyi sil" }).click();
    await expect(page.locator("#journal-body")).toHaveValue(writing);
    await assertNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Paylaşımı hazırla" }).click();
    await expect(page.getByRole("heading", { name: "Velimin göreceği" })).toBeVisible({
      timeout: 10_000,
    });
    await assertNoHorizontalOverflow(page);
    await assertComfortableTargets(page, ["Paylaş", "Taslağı kaydet"]);

    await context.close();
  });
}
