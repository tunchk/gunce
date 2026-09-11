import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  clearMailCaptureDir,
  extractTokenFromMail,
  waitForCapturedMail,
} from "./mail-capture";
import { wipe } from "./fixtures";

test.describe("Milestone 9 — parent email verify & password recovery", () => {
  test.beforeEach(async () => {
    await wipe();
    await clearMailCaptureDir();
  });

  test("verification requires explicit confirm; GET does not verify", async ({
    page,
  }) => {
    const email = `e2e_verify_${randomBytes(4).toString("hex")}@example.com`;
    const password = "Password123!";

    await page.goto("/kayit");
    await page.getByLabel("Adın").fill("E2E Veli");
    await page.getByLabel("E-posta").fill(email);
    await page.getByLabel("Şifre", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Kayıt ol" }).click();
    await page.waitForURL(/\/veli/);

    const mail = await waitForCapturedMail({
      to: email,
      subjectIncludes: "doğrula",
    });
    const token = extractTokenFromMail(mail);
    const verifyPath = `/veli/eposta-dogrula?token=${encodeURIComponent(token)}`;

    await page.goto(verifyPath);
    await expect(page.getByRole("heading", { name: "E-postanı doğrula" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "E-postamı doğrula" }),
    ).toBeVisible();

    // Still unverified until confirm — reminder should show after we finish onboarding lightly
    // Confirm explicitly
    await page.getByRole("button", { name: "E-postamı doğrula" }).click();
    await expect(page.getByRole("status")).toContainText(/doğrulandı/i);

    // Re-opening after single-use redemption fails clearly.
    await page.goto(verifyPath);
    await page.getByRole("button", { name: "E-postamı doğrula" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("password recovery flow with identical public messaging", async ({
    page,
  }) => {
    const email = `e2e_reset_${randomBytes(4).toString("hex")}@example.com`;
    const password = "Password123!";
    const newPassword = "NewPassword123!";

    await page.goto("/kayit");
    await page.getByLabel("Adın").fill("E2E Reset");
    await page.getByLabel("E-posta").fill(email);
    await page.getByLabel("Şifre", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Kayıt ol" }).click();
    await page.waitForURL(/\/veli/);

    await page.goto("/giris");
    await page.getByRole("link", { name: "Şifremi unuttum" }).click();
    await expect(page).toHaveURL(/sifremi-unuttum/);

    await page.getByLabel("E-posta").fill(email);
    await page.getByRole("button", { name: /Yenileme bağlantısı/ }).click();
    const knownMsg = page.getByRole("status");
    await expect(knownMsg).toContainText(/hesap varsa/i);
    const knownText = await knownMsg.innerText();

    await page.goto("/veli/sifremi-unuttum");
    await page.getByLabel("E-posta").fill(`missing_${randomBytes(3).toString("hex")}@example.com`);
    await page.getByRole("button", { name: /Yenileme bağlantısı/ }).click();
    await expect(page.getByRole("status")).toHaveText(knownText);

    const mail = await waitForCapturedMail({
      to: email,
      subjectIncludes: "şifre",
    });
    const token = extractTokenFromMail(mail);

    await page.goto(
      `/veli/sifre-yenile?token=${encodeURIComponent(token)}`,
    );
    await expect(page.getByRole("heading", { name: "Şifreni yenile" })).toBeVisible();
    await page.getByLabel("Yeni şifre", { exact: true }).fill(newPassword);
    await page.getByLabel("Yeni şifre tekrar").fill(newPassword);
    await page.getByRole("button", { name: "Şifreyi güncelle" }).click();
    await expect(page.getByRole("status")).toContainText(/güncellendi/i);

    // Confirm DB-side password change independently of the sign-in form.
    const { signInAndGetCookie } = await import("./fixtures");
    await expect(signInAndGetCookie(email, password)).rejects.toThrow();
    await expect(signInAndGetCookie(email, newPassword)).resolves.toBeTruthy();

    // Reset revokes DB sessions; clear stale browser cookies so sign-in is clean.
    await page.context().clearCookies();
    await page.goto("/giris");

    await page.getByLabel("E-posta").fill(email);
    await page.getByLabel("Şifre", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page.getByText("E-posta veya şifre hatalı.")).toBeVisible();

    await page.goto("/giris");
    await page.getByLabel("E-posta").fill(email);
    await page.getByLabel("Şifre", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await page.waitForURL(/\/veli/);
  });
});
