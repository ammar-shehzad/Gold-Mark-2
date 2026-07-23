import AppShell from "@/components/AppShell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { runFullSync } from "@/lib/googleSheets";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function syncNow() {
  "use server";
  await requireAdmin();
  const result = await runFullSync();
  redirect(
    `/google-sheets?ok=Sync+complete+%E2%80%94+${result.exported}+exported%2C+${result.imported}+imported%2C+${result.conflicts}+conflict(s)`
  );
}

async function disconnect() {
  "use server";
  await requireAdmin();
  const supabase = await supabaseServer();
  await supabase
    .from("mallpay_google_sheets_settings")
    .update({ connected: false, refresh_token: null, google_email: null, updated_at: new Date().toISOString() })
    .eq("id", true);
  redirect("/google-sheets?ok=Disconnected");
}

async function toggleSyncEnabled(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = await supabaseServer();
  const enabled = formData.get("sync_enabled") === "on";
  await supabase.from("mallpay_google_sheets_settings").update({ sync_enabled: enabled }).eq("id", true);
  redirect(`/google-sheets?ok=Daily+auto-sync+${enabled ? "enabled" : "paused"}`);
}

type Settings = {
  connected: boolean;
  google_email: string | null;
  spreadsheet_url: string | null;
  sync_enabled: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
};
type LogRow = {
  id: number;
  ran_at: string;
  invoices_exported: number;
  invoices_imported: number;
  conflicts: number;
  error: string | null;
};

export default async function GoogleSheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const supabase = await supabaseServer();

  const [{ data: settingsRaw }, { data: logRaw }] = await Promise.all([
    supabase.from("mallpay_google_sheets_settings").select("*").eq("id", true).single(),
    supabase.from("mallpay_sheet_sync_log").select("*").order("ran_at", { ascending: false }).limit(10),
  ]);
  const settings = settingsRaw as unknown as Settings | null;
  const log = (logRaw ?? []) as LogRow[];

  return (
    <AppShell user={user} active="/google-sheets">
      <h1>Google Sheets sync</h1>
      {sp.ok && <div className="flash ok">{sp.ok}</div>}
      {sp.err && <div className="flash err">{sp.err}</div>}

      <div className="card" style={{ maxWidth: 640 }}>
        {!settings?.connected ? (
          <>
            <h2>Connect your Google account</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Syncs your invoice ledger to a Google Sheet daily. Editing <strong>Status</strong> or <strong>Note</strong> in
              the sheet updates the app too - shop, period, and amount are read-only in the sheet and can never be
              changed from there.
            </p>
            <a className="btn" href="/api/google/oauth/start">Connect Google account</a>
          </>
        ) : (
          <>
            <h2>Connected</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {settings.google_email}
              {settings.spreadsheet_url && (
                <>
                  {" · "}
                  <a href={settings.spreadsheet_url} target="_blank" rel="noreferrer">Open the sheet</a>
                </>
              )}
            </p>
            <p style={{ fontSize: 13.5 }}>
              Last sync:{" "}
              {settings.last_synced_at
                ? new Date(settings.last_synced_at).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
                : "never"}
              {settings.last_sync_status === "ok" && <span className="badge paid" style={{ marginLeft: 8 }}>OK</span>}
              {settings.last_sync_status === "error" && (
                <span className="badge unpaid" title={settings.last_sync_error ?? ""} style={{ marginLeft: 8 }}>Error</span>
              )}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <form action={syncNow}><button className="btn">Sync now</button></form>
              <form action={toggleSyncEnabled}>
                <input type="hidden" name="sync_enabled" value={settings.sync_enabled ? "" : "on"} />
                <button className="btn ghost">{settings.sync_enabled ? "Pause daily auto-sync" : "Resume daily auto-sync"}</button>
              </form>
              <form action={disconnect}><button className="btn ghost" style={{ color: "var(--danger)" }}>Disconnect</button></form>
            </div>
          </>
        )}
      </div>

      {settings?.connected && (
        <div className="card">
          <h2>Recent sync history</h2>
          {log.length === 0 ? (
            <p className="muted">No syncs have run yet.</p>
          ) : (
            <div className="tablewrap"><table>
              <thead><tr><th>When</th><th className="r">Exported</th><th className="r">Imported</th><th className="r">Conflicts</th><th>Error</th></tr></thead>
              <tbody>
                {log.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.ran_at).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                    <td className="r num">{row.invoices_exported}</td>
                    <td className="r num">{row.invoices_imported}</td>
                    <td className="r num">{row.conflicts}</td>
                    <td className="rowsub">{row.error ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}
    </AppShell>
  );
}
