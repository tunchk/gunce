/**
 * Load `.env` then `.env.local` into process.env (local values win).
 * Used by standalone worker scripts; Next.js loads these itself.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function loadLocalEnv() {
  const root = process.cwd();
  parseEnvFile(resolve(root, ".env"));
  parseEnvFile(resolve(root, ".env.local"));
}
