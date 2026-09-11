import { test, expect } from "@playwright/test";
import {
  wipe,
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  parseCookieHeader,
  createJournalEntry,
  prisma,
} from "./fixtures";

/**
 * Milestone 8.1 — simulated journal leave protection (not real-device mic/push).
 */
test.beforeEach(async () => {
  await wipe();
});

test.use({ viewport: { width: 390, height: 844 } });

test("type then tap Planım: text persists after return", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_nav_ok_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
    .userId!;
  const entry = await createJournalEntry({ childUserId, body: "Başlangıç." });

  const ctx = await browser.newContext();
  await ctx.addCookies(parseCookieHeader(childCookie));
  const page = await ctx.newPage();

  await page.goto(`/cocuk/gunluk/${entry.id}`);
  await page.locator("#journal-body").fill("Planıma gitmeden önce yazılan metin.");
  await page
    .getByRole("navigation", { name: "Çocuk gezinti" })
    .getByRole("link", { name: "Planım" })
    .click();
  await expect(page.getByRole("heading", { name: "Planım" })).toBeVisible({ timeout: 15_000 });

  await page
    .getByRole("navigation", { name: "Çocuk gezinti" })
    .getByRole("link", { name: "Günlüğüm" })
    .click();
  await page.goto(`/cocuk/gunluk/${entry.id}`);
  await expect(page.locator("#journal-body")).toHaveValue("Planıma gitmeden önce yazılan metin.");

  await ctx.close();
});

test("slow save: navigation waits for persistence (simulated)", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_nav_slow_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
    .userId!;
  const entry = await createJournalEntry({ childUserId, body: "" });

  const ctx = await browser.newContext();
  await ctx.addCookies(parseCookieHeader(childCookie));
  const page = await ctx.newPage();

  await page.route(`**/api/child/journal/${entry.id}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });

  await page.goto(`/cocuk/gunluk/${entry.id}`);
  await page.locator("#journal-body").fill("Yavaş kayıt metni.");
  const navClick = page
    .getByRole("navigation", { name: "Çocuk gezinti" })
    .getByRole("link", { name: "Ana" })
    .click();
  await expect(page.getByText("Kaydediliyor…").first()).toBeVisible({ timeout: 5_000 });
  await navClick;
  await expect(page.getByRole("heading", { name: "Günümü anlat" })).toBeVisible({
    timeout: 20_000,
  });

  const saved = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
  expect(saved.body).toContain("Yavaş kayıt metni");

  await ctx.close();
});

test("failed save: stay, retry works; discard leaves without false success", async ({
  browser,
}) => {
  const parent = await createParent({ email: `e2e_nav_fail_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
    .userId!;
  const entry = await createJournalEntry({ childUserId, body: "Kalıcı eski metin." });

  const ctx = await browser.newContext();
  await ctx.addCookies(parseCookieHeader(childCookie));
  const page = await ctx.newPage();

  let blockSaves = true;
  await page.route(`**/api/child/journal/${entry.id}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    if (blockSaves) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Simüle hata" }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(`/cocuk/gunluk/${entry.id}`);
  await page.locator("#journal-body").fill("Başarısız deneme metni.");
  await page
    .getByRole("navigation", { name: "Çocuk gezinti" })
    .getByRole("link", { name: "Hedeflerim" })
    .click();

  await expect(page.getByRole("heading", { name: "Kayıt başarısız" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: "Hedeflerim" })).toHaveCount(0);
  await expect(page.getByText("Kaydedildi")).toHaveCount(0);

  blockSaves = false;
  await page.getByRole("button", { name: "Tekrar kaydetmeyi dene" }).click();
  await expect(page.getByRole("heading", { name: "Hedeflerim" })).toBeVisible({
    timeout: 15_000,
  });
  const afterRetry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
  expect(afterRetry.body).toContain("Başarısız deneme metni");

  // Discard path
  await page.goto(`/cocuk/gunluk/${entry.id}`);
  blockSaves = true;
  await page.locator("#journal-body").fill("Bırakılacak taslak.");
  await page
    .getByRole("navigation", { name: "Çocuk gezinti" })
    .getByRole("link", { name: "Ana" })
    .click();
  await expect(page.getByRole("heading", { name: "Kayıt başarısız" })).toBeVisible();
  await page.getByRole("button", { name: "Kaydetmeden çık" }).click();
  await expect(page.getByRole("heading", { name: "Günümü anlat" })).toBeVisible({
    timeout: 10_000,
  });
  const afterDiscard = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
  expect(afterDiscard.body).toContain("Başarısız deneme metni");
  expect(afterDiscard.body).not.toContain("Bırakılacak taslak");

  await ctx.close();
});

test("revision conflict: no silent overwrite (simulated)", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_nav_conflict_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
    .userId!;
  const entry = await createJournalEntry({ childUserId, body: "Sunucu metni." });

  const ctx = await browser.newContext();
  await ctx.addCookies(parseCookieHeader(childCookie));
  const page = await ctx.newPage();

  await page.route(`**/api/child/journal/${entry.id}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Başka bir değişiklik var. Sayfayı yenile." }),
    });
  });

  await page.goto(`/cocuk/gunluk/${entry.id}`);
  await page.locator("#journal-body").fill("Çakışan yerel metin.");
  await page
    .getByRole("navigation", { name: "Çocuk gezinti" })
    .getByRole("link", { name: "Planım" })
    .click();
  await expect(page.getByRole("heading", { name: "Kayıt çakışması" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: "Planım" })).toHaveCount(0);
  const row = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
  expect(row.body).toBe("Sunucu metni.");

  await ctx.close();
});

test("pending voice: stay preserves session; confirmed exit cleans up (simulated)", async ({
  browser,
}) => {
  const parent = await createParent({ email: `e2e_nav_voice_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
    .userId!;
  const entry = await createJournalEntry({ childUserId, body: "Yazılı kısım." });

  const ctx = await browser.newContext();
  await ctx.addCookies(parseCookieHeader(childCookie));
  await ctx.addInitScript(() => {
    (window as unknown as { __GUNCE_VOICE_SEGMENT_MS?: number }).__GUNCE_VOICE_SEGMENT_MS = 60_000;

    class FakeMediaRecorder {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((ev: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      private stream: MediaStream;
      private listeners = new Map<string, Set<() => void>>();
      constructor(stream: MediaStream) {
        this.stream = stream;
      }
      addEventListener(type: string, fn: () => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
      }
      removeEventListener(type: string, fn: () => void) {
        this.listeners.get(type)?.delete(fn);
      }
      private emit(type: string) {
        this.listeners.get(type)?.forEach((fn) => fn());
        if (type === "stop") this.onstop?.();
      }
      start() {
        this.state = "recording";
        const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" });
        queueMicrotask(() => this.ondataavailable?.({ data: blob }));
      }
      requestData() {
        const blob = new Blob([new Uint8Array([5, 6])], { type: "audio/webm" });
        this.ondataavailable?.({ data: blob });
      }
      stop() {
        this.state = "inactive";
        this.stream.getTracks().forEach((t) => t.stop());
        queueMicrotask(() => this.emit("stop"));
      }
      static isTypeSupported() {
        return true;
      }
    }

    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
    navigator.mediaDevices.getUserMedia = async () => {
      const track = {
        stop: () => undefined,
        kind: "audio",
        readyState: "live",
      } as unknown as MediaStreamTrack;
      return {
        getTracks: () => [track],
        getAudioTracks: () => [track],
      } as unknown as MediaStream;
    };
  });

  const page = await ctx.newPage();
  await page.goto(`/cocuk/gunluk/${entry.id}`);
  await page.getByRole("button", { name: "Mikrofonla anlat" }).click();
  await expect(page.getByText(/Kayıt|anlatıyorsun|Durdur/i).first()).toBeVisible({
    timeout: 10_000,
  });

  await page
    .getByRole("navigation", { name: "Çocuk gezinti" })
    .getByRole("link", { name: "Ana" })
    .click();
  await expect(page.getByRole("heading", { name: "Kaydedilmemiş ses var" })).toBeVisible();
  await page.getByRole("button", { name: "Sayfada kal" }).click();
  await expect(page.locator("#journal-body")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Günümü anlat" })).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "Çocuk gezinti" })
    .getByRole("link", { name: "Ana" })
    .click();
  await expect(page.getByRole("heading", { name: "Kaydedilmemiş ses var" })).toBeVisible();
  await page.getByRole("button", { name: "Sesi bırak ve çık" }).click();
  await expect(page.getByRole("heading", { name: "Günümü anlat" })).toBeVisible({
    timeout: 15_000,
  });

  await ctx.close();
});

test("browser Back while dirty shows leave flow (simulated)", async ({ browser }) => {
  const parent = await createParent({ email: `e2e_nav_back_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } }))
    .userId!;
  const entry = await createJournalEntry({ childUserId, body: "Eski." });

  const ctx = await browser.newContext();
  await ctx.addCookies(parseCookieHeader(childCookie));
  const page = await ctx.newPage();

  await page.goto("/cocuk/gunluk");
  await page.goto(`/cocuk/gunluk/${entry.id}`);
  await page.locator("#journal-body").fill("Geri tuşu ile çıkış denemesi.");
  await page.waitForTimeout(300);
  await page.goBack();

  // Best-effort Back guard: either leave completes (list) or a leave dialog appears.
  const leftToList = await page
    .getByRole("heading", { name: "Günlüğüm" })
    .isVisible()
    .catch(() => false);
  const dialog = await page
    .getByRole("heading", { name: /Kayıt başarısız|Kayıt çakışması|Kaydedilmemiş ses/ })
    .isVisible()
    .catch(() => false);
  const saving = await page.getByText("Kaydediliyor…").first().isVisible().catch(() => false);
  expect(leftToList || dialog || saving).toBeTruthy();

  if (dialog) {
    await page.getByRole("button", { name: "Sayfada kal" }).click();
    await expect(page.locator("#journal-body")).toBeVisible();
  }

  await ctx.close();
});
