import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  clearMailCaptureDir,
  extractTokenFromMail,
  waitForCapturedMail,
} from "./mail-capture";
import { wipe, createParent, onboardParentWithChild, prisma } from "./fixtures";

test.describe("Milestone 10 — multi-guardian", () => {
  test.beforeEach(async () => {
    await wipe();
    await clearMailCaptureDir();
  });

  test("invite → accept → plan visible; share audience isolation", async ({
    page,
    browser,
  }) => {
    const managerEmail = `mgr_e2e_${randomBytes(3).toString("hex")}@example.com`;
    const inviteeEmail = `inv_e2e_${randomBytes(3).toString("hex")}@example.com`;
    const password = "Password123!";

    // Manager registers and completes minimal onboarding via helpers for speed
    const manager = await createParent({ email: managerEmail, password });
    await prisma.user.update({
      where: { id: manager.user.id },
      data: { emailVerified: true },
    });
    const child = await onboardParentWithChild(manager.user.id);

    // Invitee registers via UI
    await page.goto("/kayit");
    await page.getByLabel("Adın").fill("İkinci Veli");
    await page.getByLabel("E-posta").fill(inviteeEmail);
    await page.getByLabel("Şifre", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Kayıt ol" }).click();
    await page.waitForURL(/\/veli/);

    // Verify invitee email via captured mail
    const verifyMail = await waitForCapturedMail({
      to: inviteeEmail,
      subjectIncludes: "doğrula",
    });
    const verifyToken = extractTokenFromMail(verifyMail);
    await page.goto(
      `/veli/eposta-dogrula?token=${encodeURIComponent(verifyToken)}`,
    );
    await page.getByRole("button", { name: "E-postamı doğrula" }).click();
    await expect(page.getByRole("status")).toContainText(/doğrulandı/i);

    // Manager invites via lib
    const { inviteGuardian, removeGuardianAccess } = await import(
      "../src/lib/guardian"
    );
    const { token: inviteToken } = await inviteGuardian({
      managerUserId: manager.user.id,
      childId: child.id,
      email: inviteeEmail,
    });

    await page.goto(`/veli/davet?token=${encodeURIComponent(inviteToken)}`);
    await page.getByRole("button", { name: "Daveti kabul et" }).click();
    await expect(page.getByRole("status")).toContainText(/kabul edildi/i);

    await page.goto("/veli/ana");
    await expect(page.getByText(child.displayName)).toBeVisible();

    // Share only to manager
    const inviteeCtx = await browser.newContext();
    const inviteePage = await inviteeCtx.newPage();
    // Keep invitee session from page; open manager in new context
    const managerCtx = await browser.newContext();
    const managerPage = await managerCtx.newPage();

    // Use API-level share setup
    const { pairChildAndGetCookie } = await import("./fixtures");
    const {
      createJournalEntry,
      updateSharingDraft,
      publishShare,
      listParentSharedContent,
    } = await import("../src/lib/journal");
    await pairChildAndGetCookie(manager.user.id, child.id);
    const childUserId = (
      await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
    ).userId!;
    const entry = await createJournalEntry({
      childUserId,
      body: "gizli",
    });
    const draft = await updateSharingDraft({
      childUserId,
      entryId: entry.id,
      parentMessage: "yalnızca yönetici",
      supportRequest: "",
      expectedRevision: entry.draft.revision,
    });
    await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: draft.draft.revision,
      recipientUserIds: [manager.user.id],
    });

    expect(
      (await listParentSharedContent(manager.user.id)).messages.some(
        (m) => m.entryId === entry.id,
      ),
    ).toBe(true);
    const inviteeUser = await prisma.user.findUniqueOrThrow({
      where: { email: inviteeEmail },
    });
    expect(
      (await listParentSharedContent(inviteeUser.id)).messages.some(
        (m) => m.entryId === entry.id,
      ),
    ).toBe(false);

    // Explicitly add invitee
    await publishShare({
      childUserId,
      entryId: entry.id,
      expectedDraftRevision: draft.draft.revision,
      recipientUserIds: [manager.user.id, inviteeUser.id],
    });
    expect(
      (await listParentSharedContent(inviteeUser.id)).messages.some(
        (m) => m.entryId === entry.id,
      ),
    ).toBe(true);

    // Remove invitee
    await removeGuardianAccess({
      managerUserId: manager.user.id,
      childId: child.id,
      targetUserId: inviteeUser.id,
    });
    expect(
      (await listParentSharedContent(inviteeUser.id)).messages.some(
        (m) => m.entryId === entry.id,
      ),
    ).toBe(false);

    await inviteePage.close();
    await managerPage.close();
    await inviteeCtx.close();
    await managerCtx.close();
  });
});
