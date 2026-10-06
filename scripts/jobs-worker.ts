/**
 * Continuous local worker for reminders + journal AI.
 * Usage: npm run jobs:worker
 *
 * Polls at a bounded interval without overlapping invocations.
 * Production should use an external scheduler; this is a local convenience only.
 */
import { loadLocalEnv } from "./load-env";

loadLocalEnv();

const INTERVAL_MS = Number(process.env.GUNCE_JOBS_POLL_MS || 5_000);
const MIN_INTERVAL_MS = 2_000;

async function tick() {
  const { processJournalAiJobs } = await import("../src/lib/journal-ai");
  const { processDueReminders } = await import("../src/lib/reminder");
  const reminders = await processDueReminders();
  const journalAi = await processJournalAiJobs();
  const summary = {
    ok: true,
    at: new Date().toISOString(),
    reminders: {
      claimed: reminders.claimed,
      sent: reminders.sent,
      skipped: reminders.skipped,
      failed: reminders.failed,
    },
    journalAi,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary));
}

let running = false;
let stopped = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function safeTick() {
  if (running || stopped) return;
  running = true;
  try {
    await tick();
  } catch (error) {
    console.error("jobs-worker tick failed");
    console.error(error instanceof Error ? error.message : "unknown");
  } finally {
    running = false;
  }
}

function shutdown(signal: string) {
  if (stopped) return;
  stopped = true;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, stopping: signal }));
  if (timer) clearInterval(timer);
  // Allow in-flight tick to finish briefly, then exit.
  const wait = setTimeout(() => process.exit(0), running ? 8_000 : 50);
  wait.unref?.();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const interval = Math.max(MIN_INTERVAL_MS, INTERVAL_MS);
// eslint-disable-next-line no-console
console.log(
  JSON.stringify({
    ok: true,
    worker: "jobs-worker",
    intervalMs: interval,
    openaiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    database: Boolean(process.env.DATABASE_URL?.trim()),
  }),
);

void safeTick();
timer = setInterval(() => {
  void safeTick();
}, interval);
