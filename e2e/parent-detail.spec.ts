import { test, expect } from "@playwright/test";
import {
  wipe,
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  signInAndGetCookie,
  parseCookieHeader,
  createJournalEntry,
  updateSharingDraft,
  publishShare,
  withdrawShare,
  prisma,
} from "./fixtures";

test.beforeEach(async () => {
  await wipe();
});

test("child publishes concrete message; parent sees detail + guidance; withdraw hides both", async ({
  browser,
}) => {
  const parent = await createParent({ email: `e2e_parent_detail_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
    .userId!;

  const concrete = "Kesirlerde paydaları eşitlemeyi anlamadım.";
  const entry = await createJournalEntry({
    childUserId,
    body: "ÖZEL günlük: uzun özel metin",
  });
  const draft = await updateSharingDraft({
    childUserId,
    entryId: entry.id,
    parentMessage: concrete,
    supportRequest: "",
    expectedRevision: entry.draft.revision,
  });
  await publishShare({
    childUserId,
    entryId: entry.id,
    expectedDraftRevision: draft.draft.revision,
  });

  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  const parentCtx = await browser.newContext();
  await parentCtx.addCookies(parseCookieHeader(parentCookie));
  const page = await parentCtx.newPage();

  await page.goto("/veli/ana");
  await expect(page.getByText(concrete)).toBeVisible();
  await expect(page.getByText("ÖZEL günlük")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Detayı gör" }).first()).toBeVisible();

  await page.getByRole("link", { name: "Detayı gör" }).first().click();
  await expect(page.getByRole("heading", { name: "Paylaşılan mesaj" })).toBeVisible();
  await expect(page.getByText(concrete)).toBeVisible();
  await expect(page.getByText("ÖZEL günlük")).toHaveCount(0);
  await expect(page.getByText("AI önerisi · Paylaşılanlara dayanır")).toBeVisible();
  await expect(
    page.getByText(/Hangi adımda takıldığını|İstersen seni dinleyebilirim/),
  ).toBeVisible({ timeout: 15_000 });

  await withdrawShare({ childUserId, entryId: entry.id });
  await page.reload();
  await expect(page.getByText(concrete)).toHaveCount(0);

  const share = await prisma.publishedShare.findFirst({ where: { entryId: entry.id } });
  if (share) {
    await page.goto(`/veli/paylasim/${share.id}`);
    await expect(page.getByText(concrete)).toHaveCount(0);
  }

  await parentCtx.close();
});
