import { supabase } from "./supabase.js";
import { getSettings, type WhatsappSettings } from "./settings.js";
import { renderTemplate } from "./template.js";

const REMINDER_SCAN_MS = Number(process.env.REMINDER_SCAN_MS || 30 * 60_000); // 30 minutes
const CURRENCY = process.env.CURRENCY || "Rs";

function money(n: number): string {
  return `${CURRENCY} ${n.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** The due date for a 'YYYY-MM' period, with due_day_of_month clamped to that month's last day. */
function computeDueDate(period: string, dueDayOfMonth: number): Date {
  const [year, month] = period.split("-").map(Number); // month is 1-indexed
  const daysInMonth = new Date(year, month, 0).getDate();
  const clampedDay = Math.min(dueDayOfMonth, daysInMonth);
  return new Date(year, month - 1, clampedDay);
}

/** Whole-day difference (a - b), ignoring time-of-day, so scan time doesn't affect the result. */
function daysBetween(a: Date, b: Date): number {
  const A = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const B = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((A - B) / 86_400_000);
}

/** Returns a stable reminder_stage key for today relative to the due date, or null if none applies. */
function determineStage(daysSinceDue: number, settings: WhatsappSettings): string | null {
  if (daysSinceDue < 0) {
    const daysBefore = -daysSinceDue;
    return settings.reminder_days_before.includes(daysBefore) ? `before_${daysBefore}` : null;
  }
  if (daysSinceDue === 0) {
    return settings.remind_on_due_date ? "on_due" : null;
  }
  if (settings.reminder_days_after.includes(daysSinceDue)) return `after_${daysSinceDue}`;
  const maxAfter = settings.reminder_days_after.length ? Math.max(...settings.reminder_days_after) : 0;
  if (
    daysSinceDue > maxAfter &&
    settings.repeat_after_interval_days > 0 &&
    (daysSinceDue - maxAfter) % settings.repeat_after_interval_days === 0
  ) {
    return `after_${daysSinceDue}`;
  }
  return null;
}

function templateKeyForStage(stage: string): "reminder_before" | "reminder_due" | "reminder_after" {
  if (stage.startsWith("before_")) return "reminder_before";
  if (stage === "on_due") return "reminder_due";
  return "reminder_after";
}

type ScanResult = { scanned: number; enqueued: number; skippedCap: number };

export async function runReminderScan(): Promise<ScanResult> {
  const settings = await getSettings();

  const { data: invoicesRaw, error: invErr } = await supabase
    .from("invoices")
    .select("id,period,amount,shop_id")
    .eq("status", "unpaid");
  if (invErr) {
    console.error("Reminder scan: failed to read invoices:", invErr.message);
    return { scanned: 0, enqueued: 0, skippedCap: 0 };
  }
  const invoices = invoicesRaw ?? [];
  if (invoices.length === 0) return { scanned: 0, enqueued: 0, skippedCap: 0 };

  const shopIds = [...new Set(invoices.map((i) => i.shop_id))];
  const { data: shopsRaw } = await supabase.from("shops").select("id,shop_number,name,active").in("id", shopIds);
  const shopsById = new Map((shopsRaw ?? []).map((s) => [s.id, s]));

  const { data: linksRaw } = await supabase.from("mallpay_shop_owners").select("shop_id,owner_id").in("shop_id", shopIds);
  const ownerIdsByShop = new Map<number, string[]>();
  for (const l of linksRaw ?? []) {
    ownerIdsByShop.set(l.shop_id, [...(ownerIdsByShop.get(l.shop_id) ?? []), l.owner_id]);
  }
  const allOwnerIds = [...new Set((linksRaw ?? []).map((l) => l.owner_id))];
  const { data: ownersRaw } = allOwnerIds.length
    ? await supabase.from("profiles").select("id,whatsapp_number,notify_whatsapp").in("id", allOwnerIds)
    : { data: [] as { id: string; whatsapp_number: string | null; notify_whatsapp: boolean }[] };
  const ownersById = new Map((ownersRaw ?? []).map((o) => [o.id, o]));

  const templateKeys = ["reminder_before", "reminder_due", "reminder_after"];
  const { data: templatesRaw } = await supabase.from("mallpay_whatsapp_templates").select("key,body").in("key", templateKeys);
  const templatesByKey = new Map((templatesRaw ?? []).map((t) => [t.key, t.body]));

  const today = new Date();
  let enqueued = 0;
  let skippedCap = 0;

  for (const invoice of invoices) {
    const shop = shopsById.get(invoice.shop_id);
    if (!shop || !shop.active) continue;

    const ownerIds = ownerIdsByShop.get(invoice.shop_id) ?? [];
    if (ownerIds.length === 0) continue;

    const dueDate = computeDueDate(invoice.period, settings.due_day_of_month);
    const daysSinceDue = daysBetween(today, dueDate);
    const stage = determineStage(daysSinceDue, settings);
    if (!stage) continue;

    const { count: existingCount } = await supabase
      .from("mallpay_reminder_log")
      .select("id", { count: "exact", head: true })
      .eq("invoice_id", invoice.id);
    if ((existingCount ?? 0) >= settings.max_reminders_per_invoice) {
      skippedCap++;
      continue;
    }

    for (const ownerId of ownerIds) {
      const owner = ownersById.get(ownerId);

      // Reserve -> send -> compensate: no cross-table transactions in
      // Supabase JS, so the log row is inserted FIRST (claiming this
      // invoice/owner/stage), and rolled back manually if we end up not
      // sending after all. This is what makes the unique constraint a
      // reliable dedup guard even if the scan is interrupted mid-run.
      const { data: logRow, error: logErr } = await supabase
        .from("mallpay_reminder_log")
        .insert({ invoice_id: invoice.id, owner_id: ownerId, reminder_stage: stage })
        .select("id")
        .single();
      if (logErr) {
        if (logErr.code !== "23505") {
          console.error(`Reminder log insert failed for invoice ${invoice.id}/owner ${ownerId}:`, logErr.message);
        }
        continue; // 23505 = already sent this stage to this owner for this invoice
      }

      if (!owner?.whatsapp_number || !owner.notify_whatsapp) {
        await supabase.from("mallpay_reminder_log").delete().eq("id", logRow.id);
        continue;
      }

      const templateBody = templatesByKey.get(templateKeyForStage(stage));
      if (!templateBody) {
        console.error(`No template found for stage "${stage}" — skipping invoice ${invoice.id}`);
        await supabase.from("mallpay_reminder_log").delete().eq("id", logRow.id);
        continue;
      }

      const message = renderTemplate(templateBody, {
        shop_number: shop.shop_number,
        period_label: periodLabel(invoice.period),
        amount: money(Number(invoice.amount)),
        due_date: dueDate.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }),
        days_overdue: String(Math.max(daysSinceDue, 0)),
      });

      const { data: outboxRow, error: outboxErr } = await supabase
        .from("mallpay_whatsapp_outbox")
        .insert({
          to_number: owner.whatsapp_number,
          message,
          kind: "reminder",
          related_table: "invoices",
          related_id: invoice.id,
        })
        .select("id")
        .single();

      if (outboxErr || !outboxRow) {
        console.error(`Failed to enqueue reminder for invoice ${invoice.id}/owner ${ownerId}:`, outboxErr?.message);
        await supabase.from("mallpay_reminder_log").delete().eq("id", logRow.id);
        continue;
      }

      await supabase.from("mallpay_reminder_log").update({ outbox_id: outboxRow.id }).eq("id", logRow.id);
      enqueued++;
    }
  }

  console.log(
    `Reminder scan: ${invoices.length} unpaid invoice(s) scanned, ${enqueued} reminder(s) enqueued, ${skippedCap} skipped (cap reached).`
  );
  return { scanned: invoices.length, enqueued, skippedCap };
}

export function startReminderLoop(): void {
  console.log(`Scanning for due reminders every ${Math.round(REMINDER_SCAN_MS / 60_000)} minute(s).`);
  const tick = async () => {
    try {
      await runReminderScan();
    } catch (err) {
      console.error("Reminder scan error:", err);
    } finally {
      setTimeout(tick, REMINDER_SCAN_MS);
    }
  };
  setTimeout(tick, REMINDER_SCAN_MS);
}
