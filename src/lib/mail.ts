import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Minimal mail interface for Better Auth email hooks.
 *
 * Transports (this milestone only):
 * - memory (+ optional capture files): automated tests via GUNCE_MAIL_TEST_CAPTURE
 * - file preview: local dev via GUNCE_MAIL_PREVIEW=1 (never production)
 *
 * A future provider should implement the same sendMail() contract.
 */

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type CapturedMail = MailMessage & {
  id: string;
  createdAt: string;
};

export class MailDeliveryError extends Error {
  readonly code = "MAIL_DELIVERY_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "MailDeliveryError";
  }
}

const memoryInbox: CapturedMail[] = [];

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Real production hosts are never loopback — blocks accidental capture on deploy. */
function appHostIsLoopback(): boolean {
  const raw =
    process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function testCaptureEnabled(): boolean {
  if (process.env.GUNCE_MAIL_TEST_CAPTURE !== "1") return false;
  if (isProductionRuntime()) {
    // Even with GUNCE_ALLOW_MAIL_TEST_CAPTURE, refuse non-loopback production hosts.
    if (!appHostIsLoopback()) return false;
    if (process.env.GUNCE_ALLOW_MAIL_TEST_CAPTURE !== "1") return false;
  }
  return true;
}

function previewEnabled(): boolean {
  if (process.env.GUNCE_MAIL_PREVIEW !== "1") return false;
  if (isProductionRuntime()) return false;
  return true;
}

export function isMailDeliveryAvailable(): boolean {
  return testCaptureEnabled() || previewEnabled();
}

export function getMailTransportKind(): "memory" | "file" | "none" {
  if (testCaptureEnabled()) return "memory";
  if (previewEnabled()) return "file";
  return "none";
}

/** Test helper — in-process capture only. */
export function getCapturedMails(): CapturedMail[] {
  return [...memoryInbox];
}

export function clearCapturedMails(): void {
  memoryInbox.length = 0;
}

export function findCapturedMail(predicate: (m: CapturedMail) => boolean): CapturedMail | undefined {
  for (let i = memoryInbox.length - 1; i >= 0; i -= 1) {
    const mail = memoryInbox[i]!;
    if (predicate(mail)) return mail;
  }
  return undefined;
}

/** Extract first http(s) link from a plain-text body (for tests). */
export function extractLinkFromMail(mail: CapturedMail): string | null {
  const match = mail.text.match(/https?:\/\/\S+/);
  return match?.[0] ?? null;
}

function previewDir(): string {
  const configured = process.env.GUNCE_MAIL_PREVIEW_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), ".mail-preview");
}

function testCaptureDir(): string {
  const configured = process.env.GUNCE_MAIL_CAPTURE_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), ".mail-capture");
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 48);
}

/**
 * Sanitized operational log — never includes recipient, body, or token links.
 */
export function reportMailFailure(purpose: string, error: unknown): void {
  const code =
    error instanceof MailDeliveryError
      ? error.code
      : error instanceof Error
        ? error.name
        : "UNKNOWN";
  console.error(`[gunce:mail] delivery failed purpose=${purpose} code=${code}`);
}

async function writePreviewFile(message: MailMessage): Promise<void> {
  if (isProductionRuntime()) {
    throw new MailDeliveryError("Mail preview is unavailable in production");
  }
  const dir = previewDir();
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = randomBytes(4).toString("hex");
  const file = path.join(dir, `${stamp}-${id}.html`);
  const linkMatch = message.text.match(/https?:\/\/\S+/);
  const link = linkMatch?.[0];
  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="referrer" content="no-referrer" />
  <title>${escapeHtml(message.subject)}</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem;">
  <h1>${escapeHtml(message.subject)}</h1>
  <p><strong>Alıcı:</strong> ${escapeHtml(message.to)}</p>
  <pre style="white-space: pre-wrap; background: #f4f4f4; padding: 1rem;">${escapeHtml(message.text)}</pre>
  ${
    link
      ? `<p><a href="${escapeHtml(link)}">Bağlantıyı aç</a></p>`
      : ""
  }
  <p style="color:#666;font-size:0.875rem;">Yerel önizleme dosyası — üretim e-posta gönderimi değildir. Dosyayı tarayıcıda aç: <code>${escapeHtml(file)}</code></p>
</body>
</html>
`;
  await writeFile(file, html, "utf8");
  // Path only — no recipient/body/token in logs.
  console.info(`[gunce:mail] preview written path=${file}`);
}

async function writeCaptureFile(captured: CapturedMail): Promise<void> {
  const dir = testCaptureDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(
    dir,
    `${sanitizeFilenamePart(captured.createdAt)}-${captured.id}.json`,
  );
  await writeFile(file, JSON.stringify(captured, null, 2), "utf8");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send mail via the active local/test transport.
 * Throws MailDeliveryError when no transport is configured or write fails.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const captured: CapturedMail = {
    id: randomBytes(8).toString("hex"),
    createdAt: new Date().toISOString(),
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  };

  if (testCaptureEnabled()) {
    memoryInbox.push(captured);
    try {
      await writeCaptureFile(captured);
    } catch (error) {
      reportMailFailure("test-capture-file", error);
      // Memory capture still succeeded for in-process tests.
    }
    return;
  }

  if (previewEnabled()) {
    await writePreviewFile(message);
    return;
  }

  if (isProductionRuntime() && process.env.GUNCE_MAIL_PREVIEW === "1") {
    throw new MailDeliveryError("Mail preview cannot operate in production");
  }

  throw new MailDeliveryError("Mail transport is not configured");
}
