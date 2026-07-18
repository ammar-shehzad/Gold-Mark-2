import { supabase } from "./supabase.js";

export type WhatsappSettings = {
  due_day_of_month: number;
  reminder_days_before: number[];
  remind_on_due_date: boolean;
  reminder_days_after: number[];
  repeat_after_interval_days: number;
  max_reminders_per_invoice: number;
  sending_days: number[]; // ISO weekday, 1=Mon..7=Sun
  sending_hour_start: number;
  sending_hour_end: number;
  delay_min_seconds: number;
  delay_max_seconds: number;
  max_messages_per_minute: number;
  batch_size: number;
  batch_pause_seconds: number;
  queue_state: "running" | "paused" | "disabled";
};

const DEFAULTS: WhatsappSettings = {
  due_day_of_month: 5,
  reminder_days_before: [7, 3, 1],
  remind_on_due_date: true,
  reminder_days_after: [3, 7, 14],
  repeat_after_interval_days: 7,
  max_reminders_per_invoice: 6,
  sending_days: [1, 2, 3, 4, 5, 6],
  sending_hour_start: 9,
  sending_hour_end: 20,
  delay_min_seconds: 10,
  delay_max_seconds: 15,
  max_messages_per_minute: 5,
  batch_size: 20,
  batch_pause_seconds: 120,
  queue_state: "running",
};

const REFRESH_MS = 60_000;
let cached: WhatsappSettings = DEFAULTS;
let lastFetch = 0;

async function fetchSettings(): Promise<WhatsappSettings> {
  const { data, error } = await supabase
    .from("mallpay_whatsapp_settings")
    .select("*")
    .eq("id", true)
    .single();
  if (error || !data) {
    console.error("Failed to load mallpay_whatsapp_settings, using built-in defaults:", error?.message);
    return DEFAULTS;
  }
  return data as unknown as WhatsappSettings;
}

/** Cached settings, refreshed from the DB at most once every REFRESH_MS so admin changes apply without a restart. */
export async function getSettings(): Promise<WhatsappSettings> {
  const now = Date.now();
  if (now - lastFetch > REFRESH_MS) {
    cached = await fetchSettings();
    lastFetch = now;
  }
  return cached;
}
