import { test, expect, type Page } from "@playwright/test";
import {
  wipe,
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  signInAndGetCookie,
  parseCookieHeader,
  prisma,
} from "./fixtures";
import { parseCalendarDate } from "../src/lib/plan-dates";

test.beforeEach(async () => {
  await wipe();
});

const ACCEPTANCE_TEXT =
  "Yarın Almanca kelime sınavım var. Bu akşam kelimelere çalışmam lazım. Basketbolda güzel bir pas verdim. Matematik ödevinin teslim tarihini bilmiyorum.";

async function openFreeJournal(page: Page) {
  await page.goto("/cocuk/gunluk/yeni");
  await page.getByRole("radio", { name: "Kendim anlatacağım" }).click();
  await page.getByRole("button", { name: "Yazmaya başla" }).click();
  await expect(page.locator("#journal-body")).toBeVisible({ timeout: 15_000 });
}

test("journal → suggestions → select/confirm → Hafta → parent read-only", async ({
  browser,
}) => {
  const parent = await createParent({
    email: `e2e_extract_${Date.now()}@example.com`,
  });
  const child = await onboardParentWithChild(parent.user.id);
  await prisma.childProfile.update({
    where: { id: child.id },
    data: { timeZone: "Europe/Berlin" },
  });
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);

  const childCtx = await browser.newContext();
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const page = await childCtx.newPage();

  await openFreeJournal(page);
  await page.locator("#journal-body").fill(ACCEPTANCE_TEXT);
  await page.getByRole("button", { name: "Kaydet (bende kalsın)" }).click();
  await expect(page.getByText("Kaydedildi")).toBeVisible({ timeout: 10_000 });

  // Pin diary date for relative resolution (Thu 10 Sep 2026).
  const entryId = page.url().split("/gunluk/")[1]!.split(/[/?#]/)[0]!;
  await prisma.journalEntry.update({
    where: { id: entryId },
    data: { diaryDate: parseCalendarDate("2026-09-10") },
  });

  await page.getByRole("link", { name: "Planıma neler ekleyebilirim?" }).click();
  await expect(page.getByRole("heading", { name: "Plan önerileri" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Plan önerilerini hazırla" }).click();
  await expect(
    page.locator('input[value="Almanca kelime sınavı"]'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('input[value="Matematik ödevi"]')).toBeVisible();
  await expect(page.getByText(/Basketbol/i)).toHaveCount(0);

  const examSection = page.getByTestId("plan-extract-candidate-EXAM");
  const prepSection = page.getByTestId("plan-extract-candidate-STUDY_STEP");
  await examSection.getByRole("checkbox", { name: "Seç" }).check();
  await examSection.locator('input[type="date"]').fill("2026-09-11");
  await prepSection.getByRole("checkbox", { name: "Seç" }).check();
  const leaveUnscheduled = prepSection.getByRole("checkbox", {
    name: "Tarihsiz bırak",
  });
  if (await leaveUnscheduled.isChecked()) {
    await leaveUnscheduled.uncheck();
  }
  await prepSection.locator('input[type="date"]').fill("2026-09-10");

  await page
    .getByRole("checkbox", {
      name: /Planına eklediklerini velin de görebilir/,
    })
    .check();
  await page.getByRole("button", { name: "Seçtiklerimi planıma ekle" }).click();
  await expect(page.getByText("Planına eklendi.", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("link", { name: "Planımı gör" }).click();

  await expect(page.getByText("Almanca kelime sınavı")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Almanca kelimelerine çalış")).toBeVisible();
  await expect(page.getByText("Matematik ödevi")).toHaveCount(0);

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const parentCtx = await browser.newContext();
  await parentCtx.addCookies(parseCookieHeader(parentCookie));
  const parentPage = await parentCtx.newPage();
  await parentPage.goto("/veli/plan");
  await expect(parentPage.getByText("Almanca kelime sınavı")).toBeVisible({
    timeout: 15_000,
  });
  await expect(parentPage.getByText("Almanca kelimelerine çalış")).toBeVisible();
  await expect(parentPage.getByText(ACCEPTANCE_TEXT)).toHaveCount(0);
  await expect(parentPage.getByText("Bunu nereden çıkardık")).toHaveCount(0);
  await expect(parentPage.getByRole("button", { name: /ekle|düzenle|sil/i })).toHaveCount(
    0,
  );

  await childCtx.close();
  await parentCtx.close();
});
