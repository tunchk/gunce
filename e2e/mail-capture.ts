import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { CapturedMail } from "../src/lib/mail";

const CAPTURE_DIR =
  process.env.GUNCE_MAIL_CAPTURE_DIR ||
  path.join(process.cwd(), ".mail-capture");

export async function clearMailCaptureDir() {
  await rm(CAPTURE_DIR, { recursive: true, force: true });
}

export async function waitForCapturedMail(options: {
  to?: string;
  subjectIncludes?: string;
  timeoutMs?: number;
}): Promise<CapturedMail> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const files = await readdir(CAPTURE_DIR);
      const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
      for (let i = jsonFiles.length - 1; i >= 0; i -= 1) {
        const raw = await readFile(path.join(CAPTURE_DIR, jsonFiles[i]!), "utf8");
        const mail = JSON.parse(raw) as CapturedMail;
        if (options.to && mail.to !== options.to) continue;
        if (
          options.subjectIncludes &&
          !mail.subject.toLowerCase().includes(options.subjectIncludes.toLowerCase())
        ) {
          continue;
        }
        return mail;
      }
    } catch {
      // dir may not exist yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `No captured mail matching ${JSON.stringify(options)} within ${timeoutMs}ms`,
  );
}

export function extractTokenFromMail(mail: CapturedMail): string {
  const match = mail.text.match(/https?:\/\/\S+/);
  if (!match) throw new Error("No link in mail");
  const url = new URL(match[0]!);
  const token = url.searchParams.get("token");
  if (!token) throw new Error("No token in mail link");
  return token;
}
