import { expect, test } from "@playwright/test";
import {
  wipe,
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  signInAndGetCookie,
  parseCookieHeader,
  prisma,
} from "./fixtures";
import { createStudyStep } from "../src/lib/plan";

test.beforeEach(async () => {
  await wipe();
});

test.use({ viewport: { width: 390, height: 844 } });

test("child asks help → parent offers → child accepts → visible on schedules", async ({
  browser,
}) => {
  const parent = await createParent({ email: `e2e_help_${Date.now()}@example.com` });
  await prisma.user.update({
    where: { id: parent.user.id },
    data: { emailVerified: true },
  });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (
    await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
  ).userId!;

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const step = await createStudyStep({
    childUserId,
    title: "E2E matematik yardım",
    plannedDate: today,
  });

  const childCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const childPage = await childCtx.newPage();

  await childPage.goto(`/cocuk/plan/adim/${step.id}`);
  await childPage.getByRole("link", { name: "Yardım iste" }).click();
  await expect(childPage.getByRole("heading", { name: "Nasıl bir yardım?" })).toBeVisible();
  await childPage.getByLabel("Birlikte yapalım").click();
  await childPage.getByPlaceholder("İsteğe bağlı kısa not").fill("Birlikte 5 soru");
  await childPage.getByRole("button", { name: "Yardım iste" }).click();
  await expect(childPage.getByText("Yardım istedin")).toBeVisible({ timeout: 10_000 });

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const parentCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await parentCtx.addCookies(parseCookieHeader(parentCookie));
  const parentPage = await parentCtx.newPage();

  await parentPage.goto("/veli/yardim");
  await expect(parentPage.getByText("E2E matematik yardım")).toBeVisible();
  await parentPage.getByRole("button", { name: "Yardım edebilirim" }).first().click();
  await expect(parentPage.getByText("Ne zaman yardım edebilirsin?")).toBeVisible();
  await parentPage.getByLabel("Tarih").fill(today);
  await parentPage.getByLabel("Saat").fill("18:00");
  await parentPage.getByRole("button", { name: "Öner" }).click();
  await expect(parentPage.getByText(/Teklifin bekliyor/)).toBeVisible({ timeout: 10_000 });

  await childPage.goto("/cocuk/yardim");
  await childPage.getByRole("link", { name: /E2E matematik yardım/ }).click();
  await expect(childPage.getByText(/yardım edebilir/)).toBeVisible();
  await childPage.getByRole("button", { name: "Kabul et" }).click();
  await expect(childPage.getByText("Yardım planlandı")).toBeVisible({ timeout: 10_000 });

  await childPage.goto("/cocuk/haftam");
  await expect(childPage.getByRole("heading", { name: "Planlanan yardımlar" })).toBeVisible();
  await expect(childPage.getByText("E2E matematik yardım").first()).toBeVisible();

  await parentPage.goto("/veli/yardim");
  await expect(parentPage.getByRole("heading", { name: "Planlanan yardımlar" })).toBeVisible();
  await expect(parentPage.getByText(/E2E matematik yardım/).first()).toBeVisible();

  await childCtx.close();
  await parentCtx.close();
});
