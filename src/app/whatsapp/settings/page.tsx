import AppShell from "@/components/AppShell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // ISO weekday 1-7

function parseIntArray(s: string): number[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

async function saveReminderSchedule(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = await supabaseServer();
  await supabase
    .from("mallpay_whatsapp_settings")
    .update({
      due_day_of_month: Math.min(28, Math.max(1, Number(formData.get("due_day_of_month") || 5))),
      reminder_days_before: parseIntArray(String(formData.get("reminder_days_before") || "")),
      remind_on_due_date: formData.get("remind_on_due_date") === "on",
      reminder_days_after: parseIntArray(String(formData.get("reminder_days_after") || "")),
      repeat_after_interval_days: Math.max(1, Number(formData.get("repeat_after_interval_days") || 7)),
      max_reminders_per_invoice: Math.max(1, Number(formData.get("max_reminders_per_invoice") || 6)),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  redirect("/whatsapp/settings?ok=Reminder+schedule+saved");
}

async function saveSendingWindow(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = await supabaseServer();
  const days = formData.getAll("sending_days").map(Number).filter((n) => n >= 1 && n <= 7);
  await supabase
    .from("mallpay_whatsapp_settings")
    .update({
      sending_days: days,
      sending_hour_start: Math.min(23, Math.max(0, Number(formData.get("sending_hour_start") || 9))),
      sending_hour_end: Math.min(23, Math.max(0, Number(formData.get("sending_hour_end") || 20))),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  redirect("/whatsapp/settings?ok=Sending+window+saved");
}

async function saveRateLimits(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = await supabaseServer();
  const delayMin = Math.max(0, Number(formData.get("delay_min_seconds") || 10));
  const delayMax = Math.max(delayMin, Number(formData.get("delay_max_seconds") || 15));
  await supabase
    .from("mallpay_whatsapp_settings")
    .update({
      delay_min_seconds: delayMin,
      delay_max_seconds: delayMax,
      max_messages_per_minute: Math.max(1, Number(formData.get("max_messages_per_minute") || 5)),
      batch_size: Math.max(1, Number(formData.get("batch_size") || 20)),
      batch_pause_seconds: Math.max(0, Number(formData.get("batch_pause_seconds") || 120)),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  redirect("/whatsapp/settings?ok=Rate+%26+batch+limits+saved");
}

async function setQueueState(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = await supabaseServer();
  const state = String(formData.get("state") || "running");
  if (!["running", "paused", "disabled"].includes(state)) redirect("/whatsapp/settings");
  await supabase.from("mallpay_whatsapp_settings").update({ queue_state: state, updated_at: new Date().toISOString() }).eq("id", true);
  redirect(`/whatsapp/settings?ok=Reminder+queue+set+to+${state}`);
}

async function cancelPendingReminderQueue() {
  "use server";
  await requireAdmin();
  // Uses the service-role client: there is no `update` RLS policy on
  // mallpay_whatsapp_outbox for authenticated users (only insert + an
  // admin-only select), so a normal client update here would silently
  // affect 0 rows.
  const admin = supabaseAdmin();
  await admin.from("mallpay_whatsapp_outbox").update({ status: "cancelled" }).eq("status", "pending").eq("kind", "reminder");
  redirect("/whatsapp/settings?ok=Pending+reminders+cancelled");
}

async function saveTemplate(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = await supabaseServer();
  const key = String(formData.get("key") || "");
  const body = String(formData.get("body") || "").trim();
  if (!key || !body) redirect("/whatsapp/settings?err=Template+body+cannot+be+empty");
  await supabase.from("mallpay_whatsapp_templates").update({ body, updated_at: new Date().toISOString() }).eq("key", key);
  redirect("/whatsapp/settings?ok=Template+saved");
}

type Settings = {
  due_day_of_month: number;
  reminder_days_before: number[];
  remind_on_due_date: boolean;
  reminder_days_after: number[];
  repeat_after_interval_days: number;
  max_reminders_per_invoice: number;
  sending_days: number[];
  sending_hour_start: number;
  sending_hour_end: number;
  delay_min_seconds: number;
  delay_max_seconds: number;
  max_messages_per_minute: number;
  batch_size: number;
  batch_pause_seconds: number;
  queue_state: "running" | "paused" | "disabled";
};
type Template = { key: string; label: string; body: string };

export default async function WhatsappSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const supabase = await supabaseServer();

  const [{ data: settingsRaw }, { data: templatesRaw }] = await Promise.all([
    supabase.from("mallpay_whatsapp_settings").select("*").eq("id", true).single(),
    supabase.from("mallpay_whatsapp_templates").select("key,label,body").order("key"),
  ]);

  const settings = settingsRaw as unknown as Settings | null;
  const templates = (templatesRaw ?? []) as Template[];

  if (!settings) {
    return (
      <AppShell user={user} active="/whatsapp">
        <h1>WhatsApp settings</h1>
        <div className="card">
          <p className="muted">
            Settings haven&apos;t been set up yet — run <code>supabase/migration-whatsapp-automation.sql</code> in the
            Supabase SQL Editor, then reload this page.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} active="/whatsapp">
      <h1>WhatsApp settings</h1>
      <div className="filters">
        <Link className="btn ghost" href="/whatsapp">← Connection &amp; message log</Link>
        <Link className="btn ghost" href="/whatsapp/send" style={{ marginLeft: "auto" }}>Send targeted message</Link>
      </div>
      {sp.ok && <div className="flash ok">{sp.ok}</div>}
      {sp.err && <div className="flash err">{sp.err}</div>}

      <div className="card">
        <h2>Reminder queue</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Current state:{" "}
          {settings.queue_state === "running" && <span className="badge paid">Running</span>}
          {settings.queue_state === "paused" && <span className="badge pending">Paused</span>}
          {settings.queue_state === "disabled" && <span className="badge unpaid">Disabled</span>}
          {" "}— only affects automated maintenance reminders. Payment confirmations, complaint updates, and manual
          notices always keep sending regardless of this state.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <form action={setQueueState}><input type="hidden" name="state" value="running" /><button className="btn">Enable / Resume</button></form>
          <form action={setQueueState}><input type="hidden" name="state" value="paused" /><button className="btn ghost">Pause</button></form>
          <form action={setQueueState}><input type="hidden" name="state" value="disabled" /><button className="btn ghost">Disable</button></form>
          <form action={cancelPendingReminderQueue}><button className="btn ghost" style={{ color: "var(--danger)" }}>Cancel all pending reminders</button></form>
        </div>
      </div>

      <div className="grid c2">
        <div className="card" style={{ margin: 0 }}>
          <h2>Reminder schedule</h2>
          <form action={saveReminderSchedule}>
            <div className="field">
              <label>Due day of month <span className="muted">(1–28)</span></label>
              <input type="number" name="due_day_of_month" min={1} max={28} defaultValue={settings.due_day_of_month} required />
            </div>
            <div className="field">
              <label>Remind before due date <span className="muted">(comma-separated days, e.g. 7,3,1)</span></label>
              <input type="text" name="reminder_days_before" defaultValue={settings.reminder_days_before.join(",")} placeholder="7,3,1" />
            </div>
            <div className="field">
              <label>
                <input type="checkbox" name="remind_on_due_date" style={{ width: "auto" }} defaultChecked={settings.remind_on_due_date} />{" "}
                Send a reminder on the due date itself
              </label>
            </div>
            <div className="field">
              <label>Remind after due date <span className="muted">(comma-separated days overdue, e.g. 3,7,14)</span></label>
              <input type="text" name="reminder_days_after" defaultValue={settings.reminder_days_after.join(",")} placeholder="3,7,14" />
            </div>
            <div className="frow">
              <div className="field">
                <label>Then repeat every <span className="muted">(days)</span></label>
                <input type="number" name="repeat_after_interval_days" min={1} defaultValue={settings.repeat_after_interval_days} />
              </div>
              <div className="field">
                <label>Max reminders per invoice</label>
                <input type="number" name="max_reminders_per_invoice" min={1} defaultValue={settings.max_reminders_per_invoice} />
              </div>
            </div>
            <button className="btn">Save reminder schedule</button>
          </form>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <h2>Sending window</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Applies to automated reminders only.</p>
          <form action={saveSendingWindow}>
            <div className="field">
              <label>Allowed sending days</label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {DAY_NAMES.map((name, i) => {
                  const iso = i + 1;
                  return (
                    <label key={iso} style={{ fontSize: 14 }}>
                      <input type="checkbox" name="sending_days" value={iso} style={{ width: "auto", marginRight: 4 }}
                        defaultChecked={settings.sending_days.includes(iso)} />
                      {name}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="frow">
              <div className="field">
                <label>Sending hour — start <span className="muted">(0–23)</span></label>
                <input type="number" name="sending_hour_start" min={0} max={23} defaultValue={settings.sending_hour_start} />
              </div>
              <div className="field">
                <label>Sending hour — end <span className="muted">(0–23)</span></label>
                <input type="number" name="sending_hour_end" min={0} max={23} defaultValue={settings.sending_hour_end} />
              </div>
            </div>
            <button className="btn">Save sending window</button>
          </form>
        </div>
      </div>

      <div className="card">
        <h2>Rate &amp; batch limits</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Protects the WhatsApp number from being flagged as spam. Applies to every outgoing message, not just reminders.
        </p>
        <form action={saveRateLimits}>
          <div className="frow">
            <div className="field">
              <label>Delay between messages — min <span className="muted">(seconds)</span></label>
              <input type="number" name="delay_min_seconds" min={0} defaultValue={settings.delay_min_seconds} />
            </div>
            <div className="field">
              <label>Delay between messages — max <span className="muted">(seconds)</span></label>
              <input type="number" name="delay_max_seconds" min={0} defaultValue={settings.delay_max_seconds} />
            </div>
          </div>
          <div className="frow">
            <div className="field">
              <label>Max messages per minute</label>
              <input type="number" name="max_messages_per_minute" min={1} defaultValue={settings.max_messages_per_minute} />
            </div>
            <div className="field">
              <label>Batch size</label>
              <input type="number" name="batch_size" min={1} defaultValue={settings.batch_size} />
            </div>
          </div>
          <div className="field">
            <label>Pause after each batch <span className="muted">(seconds)</span></label>
            <input type="number" name="batch_pause_seconds" min={0} defaultValue={settings.batch_pause_seconds} />
          </div>
          <button className="btn">Save rate &amp; batch limits</button>
        </form>
      </div>

      <div className="card">
        <h2>Message templates</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Available placeholders vary by template — shop/period/amount/date tokens for reminders and payments,
          {" "}<code>{"{{title}}"}</code>/<code>{"{{body}}"}</code> for notices.
        </p>
        {templates.map((t) => (
          <form action={saveTemplate} key={t.key} style={{ marginBottom: 18 }}>
            <input type="hidden" name="key" value={t.key} />
            <div className="field">
              <label>{t.label}</label>
              <textarea name="body" rows={3} defaultValue={t.body} required />
            </div>
            <button className="btn ghost small">Save this template</button>
          </form>
        ))}
      </div>
    </AppShell>
  );
}
