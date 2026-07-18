import "dotenv/config";
import { connectWhatsApp } from "./whatsapp.js";
import { startOutboxLoop } from "./outbox.js";
import { runReminderScan, startReminderLoop } from "./reminders.js";

async function main() {
  // `--once` runs a single reminder scan and exits — for testing the
  // scan/dedup logic directly without waiting for the recurring timer or
  // needing a live WhatsApp connection (it only enqueues into the outbox;
  // actual sending happens next time the bot runs normally).
  if (process.argv.includes("--once")) {
    const result = await runReminderScan();
    console.log("Reminder scan complete:", result);
    process.exit(0);
  }

  await connectWhatsApp();
  startOutboxLoop();
  startReminderLoop();
}

main().catch((err) => {
  console.error("Fatal error starting the bot:", err);
  process.exit(1);
});
