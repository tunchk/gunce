/**
 * Local development scheduler command.
 * Usage: npx tsx scripts/process-reminders.ts
 * Or: node --import tsx scripts/process-reminders.ts
 *
 * Loads .env / .env.local if present via process env (run after sourcing).
 */
import { processDueReminders } from "../src/lib/reminder";

async function main() {
  const result = await processDueReminders();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, result }));
}

main().catch((error) => {
  console.error("process-reminders failed");
  console.error(error instanceof Error ? error.message : "unknown");
  process.exit(1);
});
