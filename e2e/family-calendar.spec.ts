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
import { createFamilyEvent } from "../src/lib/family-events";

test.beforeEach(async () => {
  await wipe();
});

test.use({ viewport: { width: 390, height: 844 } });

test("child Haftam aile view + parent takvim + conflict + cancel disappears", async ({
  browser,
}) => {
  const parent = await createParent({ email: `e2e_m13_${Date.now()}@example.com` });
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
    title: "E2E takvim ders",
    plannedDate: today,
  });
  const req = await createHelpRequest({
    childUserId,
    studyStepId: step.id,
    helpType: "DO_TOGETHER",
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

  const familyEv = await createFamilyEvent({
    actorUserId: childUserId,
    actorRole: "CHILD",
    title: "E2E aile etkinliği",
    eventDate: today,
    startTimeLocal: "18:00",
    eventType: "FAMILY",
  });

  const childCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const childPage = await childCtx.newPage();

  await childPage.goto("/cocuk/haftam?view=aile");
  await expect(childPage.getByText("E2E aile etkinliği")).toBeVisible();
  await expect(childPage.getByText("E2E takvim ders").first()).toBeVisible();
  await expect(childPage.getByTestId("possible-conflict").first()).toBeVisible();

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const parentCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await parentCtx.addCookies(parseCookieHeader(parentCookie));
  const parentPage = await parentCtx.newPage();

  await parentPage.goto("/veli/takvim");
  await expect(parentPage.getByRole("heading", { name: "Aile takvimi" })).toBeVisible();
  await expect(parentPage.getByText("E2E aile etkinliği")).toBeVisible();
  await expect(parentPage.getByText(/Yardım|18:00/).first()).toBeVisible();

  await childPage.goto(`/cocuk/takvim/etkinlik/${familyEv.id}`);
  await childPage.getByRole("button", { name: "Etkinliği iptal et" }).click();
  await expect(childPage).toHaveURL(/haftam/);
  await childPage.goto("/cocuk/haftam?view=aile");
  await expect(childPage.getByText("E2E aile etkinliği")).toHaveCount(0);

  await childCtx.close();
  await parentCtx.close();
});
