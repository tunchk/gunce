/**
 * Process durable outbox jobs once: reminders + journal AI.
 * Usage: npm run jobs:process
 */
import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main() {
  const { processJournalAiJobs } = await import("../src/lib/journal-ai");
  const { processDueReminders } = await import("../src/lib/reminder");
  const reminders = await processDueReminders();
  const journalAi = await processJournalAiJobs();
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      reminders,
      journalAi,
      openaiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    }),
  );
}

main().catch((error) => {
  console.error("process-jobs failed");
  console.error(error instanceof Error ? error.message : "unknown");
  process.exit(1);
});
