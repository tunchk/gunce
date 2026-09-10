import { test, expect } from "@playwright/test";
import {
  wipe,
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  parseCookieHeader,
} from "./fixtures";

/**
 * Simulated multi-segment recording (not real-device mic verification).
 * Injects a short segment limit and a fake MediaRecorder that emits audio blobs.
 */
test.beforeEach(async () => {
  await wipe();
});

test("record segment → duration boundary → continue → finish → ordered review", async ({
  browser,
}) => {
  const parent = await createParent({ email: `e2e_voice_seg_${Date.now()}@example.com` });
  const child = await onboardParentWithChild(parent.user.id);
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);

  const context = await browser.newContext();
  await context.addCookies(parseCookieHeader(childCookie));
  await context.addInitScript(() => {
    (window as unknown as { __GUNCE_VOICE_SEGMENT_MS?: number }).__GUNCE_VOICE_SEGMENT_MS = 600;

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

  const page = await context.newPage();
  await page.goto("/cocuk/gunluk/yeni");
  await page.getByRole("radio", { name: "Kendim anlatacağım" }).click();
  await page.getByRole("button", { name: "Yazmaya başla" }).click();
  await expect(page.locator("#journal-body")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Mikrofonla anlat" }).click();
  await expect(page.getByText(/Anlatımın 1\. bölümü/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Bu bölüm birazdan bitecek|Devam et/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Devam et" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Bitirdim" })).toBeVisible();

  await page.getByRole("button", { name: "Devam et" }).click();
  await expect(page.getByText(/Anlatımın 2\. bölümü/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Devam et" })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Bitirdim" }).click();
  await expect(page.getByLabel("Çözümlenen anlatım")).toBeVisible({ timeout: 20_000 });
  const assembled = page.getByLabel("Çözümlenen anlatım");
  await expect(assembled).not.toHaveValue("");

  await context.close();
});
