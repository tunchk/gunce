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
import {
  acceptHelpOffer,
  createHelpOffer,
  createHelpRequest,
} from "../src/lib/help";

test.beforeEach(async () => {
  await wipe();
});

test.use({ viewport: { width: 390, height: 844 } });

test("guardian edits pending offer; withdraw returns to waiting", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_help_b1_${Date.now()}@example.com` });
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
    title: "E2E teklif düzenle",
    plannedDate: today,
  });
  const req = await createHelpRequest({
    childUserId,
    studyStepId: step.id,
    helpType: "DO_TOGETHER",
  });

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const parentCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await parentCtx.addCookies(parseCookieHeader(parentCookie));
  const parentPage = await parentCtx.newPage();

  await parentPage.goto(`/veli/yardim/${req.id}`);
  await parentPage.getByLabel("Tarih").fill(today);
  await parentPage.getByLabel("Saat").fill("18:00");
  await parentPage.getByRole("button", { name: "Öner" }).click();
  await expect(parentPage.getByText(/Teklifin bekliyor/)).toBeVisible({ timeout: 10_000 });

  await parentPage.getByRole("button", { name: "Düzenle" }).click();
  await parentPage.getByLabel("Saat").fill("19:30");
  await parentPage.getByRole("button", { name: "Kaydet" }).click();
  await expect(parentPage.getByText(/19:30/)).toBeVisible({ timeout: 10_000 });

  await parentPage.getByRole("button", { name: "Teklifi geri al" }).click();
  await expect(parentPage.getByText("Ne zaman yardım edebilirsin?")).toBeVisible({
    timeout: 10_000,
  });

  const childCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const childPage = await childCtx.newPage();
  await childPage.goto(`/cocuk/yardim/${req.id}`);
  await expect(childPage.getByText("Yardım bekleniyor. Velilerin teklifleri burada görünecek.")).toBeVisible();

  await childCtx.close();
  await parentCtx.close();
});

test("accepted guardian cancels; child can pick another path", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_help_cancel_${Date.now()}@example.com` });
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
    title: "E2E gelemeyeceğim",
    plannedDate: today,
  });
  const req = await createHelpRequest({
    childUserId,
    studyStepId: step.id,
    helpType: "EXPLAIN",
  });
  const offer = await createHelpOffer({
    parentUserId: parent.user.id,
    requestId: req.id,
    proposedDate: today,
    proposedTimeLocal: "18:00",
  });
  await acceptHelpOffer({
    childUserId,
    requestId: req.id,
    offerId: offer.id,
  });

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const parentCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await parentCtx.addCookies(parseCookieHeader(parentCookie));
  const parentPage = await parentCtx.newPage();

  await parentPage.goto(`/veli/yardim/${req.id}`);
  await expect(parentPage.getByRole("button", { name: "Bu yardıma gelemeyeceğim" })).toBeVisible();
  await parentPage.getByRole("button", { name: "Bu yardıma gelemeyeceğim" }).click();
  await expect(parentPage.getByText("Ne zaman yardım edebilirsin?")).toBeVisible({
    timeout: 10_000,
  });

  const childCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const childPage = await childCtx.newPage();
  await childPage.goto(`/cocuk/yardim/${req.id}`);
  await expect(childPage.getByTestId("help-lifecycle-notice")).toBeVisible({ timeout: 10_000 });
  await expect(childPage.getByText(/Yardım bekleniyor/)).toBeVisible();

  await childCtx.close();
  await parentCtx.close();
});
