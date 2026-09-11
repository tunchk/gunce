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

test("unauthenticated users are redirected away from protected pages", async ({ page }) => {
  await page.goto("/veli/ana");
  await expect(page).toHaveURL(/\/giris/);

  await page.goto("/cocuk/ana");
  await expect(page).toHaveURL(/\/cocuk\/giris/);
});

test("child session cannot open parent pages as a parent", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_child_block_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);

  const context = await browser.newContext();
  await context.addCookies(parseCookieHeader(childCookie));
  const page = await context.newPage();

  await page.goto("/veli/ana");
  await expect(page).toHaveURL(/\/giris/);
  await context.close();
});

test("child shares selected content; parent sees only that; withdraw hides it", async ({
  browser,
}) => {
  const parent = await createParent({ email: `e2e_share_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
    .userId!;

  const entry = await createJournalEntry({
    childUserId,
    promptKey: "FREE",
    body: "ÖZEL GÜNLÜK METNİ",
  });
  const draft = await updateSharingDraft({
    childUserId,
    entryId: entry.id,
    parentMessage: "Velinin göreceği kısa not",
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
  const parentPage = await parentCtx.newPage();
  await parentPage.goto("/veli/ana");
  await expect(parentPage).toHaveURL(/\/veli\/ana/);
  await expect(parentPage.getByRole("heading", { name: "Benimle paylaştıkları" })).toBeVisible();
  await expect(parentPage.getByText("Velinin göreceği kısa not")).toBeVisible();
  await expect(parentPage.getByText("ÖZEL GÜNLÜK METNİ")).toHaveCount(0);

  await withdrawShare({ childUserId, entryId: entry.id });
  await parentPage.reload();
  await expect(parentPage.getByText("Velinin göreceği kısa not")).toHaveCount(0);
  await expect(
    parentPage.getByText("Henüz seninle paylaşılmış bir içerik yok"),
  ).toBeVisible();

  const childCtx = await browser.newContext();
  await childCtx.addCookies(parseCookieHeader(childCookie));
  const childPage = await childCtx.newPage();
  await childPage.goto("/cocuk/ana");
  await expect(childPage).toHaveURL(/\/cocuk\/ana/);
  await expect(childPage.getByRole("link", { name: "Günümü anlat" })).toBeVisible();

  await parentCtx.close();
  await childCtx.close();
});
