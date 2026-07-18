import { supabase } from "./supabase.js";
import { isWhatsAppReady, sendWhatsAppMessage, sendWhatsAppImageMessage } from "./whatsapp.js";
import { getSettings, type WhatsappSettings } from "./settings.js";

const POLL_MS = Number(process.env.POLL_MS || 5000);
const IMAGE_BUCKET = "complaint-photos";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type OutboxRow = { id: number; to_number: string; message: string; image_path: string | null; kind: string };

async function sendRow(row: OutboxRow): Promise<void> {
  if (!row.image_path) {
    await sendWhatsAppMessage(row.to_number, row.message);
    return;
  }
  const { data: signed, error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrl(row.image_path, 3600);
  if (error || !signed?.signedUrl) {
    console.error(`Could not sign image for outbox #${row.id}, sending text only:`, error?.message);
    await sendWhatsAppMessage(row.to_number, row.message);
    return;
  }
  await sendWhatsAppImageMessage(row.to_number, signed.signedUrl, row.message);
}

// Atomically flips a row from 'pending' to 'sent' BEFORE we actually send it,
// conditioned on it still being 'pending'. Whichever caller's UPDATE actually
// affects a row "wins" the right to send it — this is what prevents the same
// message going out twice if a poll cycle overlaps the previous one (or, if
// the bot is ever accidentally started twice, prevents both instances from
// sending the same row). If the send itself later fails, we flip it to
// 'failed' with the error — the momentary 'sent' is corrected immediately.
async function claimRow(id: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("mallpay_whatsapp_outbox")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) {
    console.error(`Failed to claim outbox #${id}, skipping this poll:`, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

// Sending-day/hour window only gates 'reminder' kind rows — pausing/disabling
// the reminder campaign shouldn't also freeze payment-approved confirmations,
// complaint updates, or manually-sent notices.
function isWithinSendingWindow(settings: WhatsappSettings, now = new Date()): boolean {
  const isoWeekday = ((now.getDay() + 6) % 7) + 1; // JS getDay(): 0=Sun..6=Sat -> ISO 1=Mon..7=Sun
  if (!settings.sending_days.includes(isoWeekday)) return false;
  const hour = now.getHours();
  return hour >= settings.sending_hour_start && hour < settings.sending_hour_end;
}

// Rolling 60s window of send timestamps, used to enforce max_messages_per_minute.
const sendTimestamps: number[] = [];
let sentSinceLastBatchPause = 0;

// Unifies the per-message delay and the per-minute rate cap into one wait —
// they both exist to pace sends, so take the stricter requirement rather
// than summing them (summing would double-throttle for no benefit).
async function waitBeforeNextSend(settings: WhatsappSettings): Promise<void> {
  const now = Date.now();
  while (sendTimestamps.length && now - sendTimestamps[0] > 60_000) sendTimestamps.shift();

  let rateLimitGapMs = 0;
  if (sendTimestamps.length >= settings.max_messages_per_minute) {
    rateLimitGapMs = Math.max(0, 60_000 - (now - sendTimestamps[0]));
  }
  const randomGapMs =
    (settings.delay_min_seconds + Math.random() * (settings.delay_max_seconds - settings.delay_min_seconds)) * 1000;

  const waitMs = Math.max(rateLimitGapMs, randomGapMs);
  if (waitMs > 0) await sleep(waitMs);
}

function recordSend(): void {
  sendTimestamps.push(Date.now());
  sentSinceLastBatchPause += 1;
}

// Batch pause is a distinct, larger periodic cooldown on top of the
// per-message pacing above — additive by design, not an alternative to it.
async function maybeBatchPause(settings: WhatsappSettings): Promise<void> {
  if (sentSinceLastBatchPause >= settings.batch_size) {
    console.log(`Sent a batch of ${sentSinceLastBatchPause} — pausing ${settings.batch_pause_seconds}s before continuing.`);
    await sleep(settings.batch_pause_seconds * 1000);
    sentSinceLastBatchPause = 0;
  }
}

async function processPending(): Promise<void> {
  if (!isWhatsAppReady()) return;

  const settings = await getSettings();

  const { data: rows, error } = await supabase
    .from("mallpay_whatsapp_outbox")
    .select("id,to_number,message,image_path,kind")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(Math.max(settings.batch_size, 1));

  if (error) {
    console.error("Failed to read mallpay_whatsapp_outbox:", error.message);
    return;
  }

  const reminderGateOpen = settings.queue_state === "running" && isWithinSendingWindow(settings);

  for (const row of (rows ?? []) as OutboxRow[]) {
    if (row.kind === "reminder" && !reminderGateOpen) continue; // leave pending, retry on a later poll

    const claimed = await claimRow(row.id);
    if (!claimed) continue; // another poll/instance already sent this one

    try {
      await sendRow(row);
      console.log(`Sent outbox #${row.id} to ${row.to_number}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const { error: markFailedError } = await supabase
        .from("mallpay_whatsapp_outbox")
        .update({ status: "failed", error: message, attempts: 1 })
        .eq("id", row.id);
      if (markFailedError) {
        console.error(`Outbox #${row.id} failed to send AND failed to mark failed:`, markFailedError.message);
      } else {
        console.error(`Failed outbox #${row.id}:`, message);
      }
    }
    recordSend();
    await waitBeforeNextSend(settings);
    await maybeBatchPause(settings);
  }
}

export function startOutboxLoop(): void {
  console.log(`Polling mallpay_whatsapp_outbox every ${POLL_MS}ms.`);
  // Self-rescheduling instead of setInterval: the next poll is only queued
  // once the current one fully finishes, so a slow poll (many pending
  // messages, each with a multi-second send delay) can never overlap with
  // the next tick and double-process the same rows.
  const tick = async () => {
    try {
      await processPending();
    } catch (err) {
      console.error("Outbox poll error:", err);
    } finally {
      setTimeout(tick, POLL_MS);
    }
  };
  setTimeout(tick, POLL_MS);
}
