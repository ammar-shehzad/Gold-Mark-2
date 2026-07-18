import AppShell from "@/components/AppShell";
import AutoRefresh from "@/components/AutoRefresh";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import QRCode from "qrcode";
import Link from "next/link";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  payment_approved: "Payment approved",
  payment_rejected: "Payment rejected",
  complaint_status: "Complaint update",
  complaint_new: "New complaint",
  notice: "Notice",
  reminder: "Maintenance reminder",
};

type OutboxRow = {
  id: number; to_number: string; message: string; kind: string; status: string;
  error: string | null; created_at: string; sent_at: string | null; scheduled_at: string;
};

export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; kind?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const supabase = await supabaseServer();
  const status = ["pending", "sent", "failed", "cancelled"].includes(sp.status ?? "") ? sp.status! : "all";
  const kind = Object.keys(KIND_LABEL).includes(sp.kind ?? "") ? sp.kind! : "all";

  const { data: connStatus } = await supabase.from("mallpay_whatsapp_status").select("*").single();

  let logQuery = supabase
    .from("mallpay_whatsapp_outbox")
    .select("id,to_number,message,kind,status,error,created_at,sent_at,scheduled_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (status !== "all") logQuery = logQuery.eq("status", status);
  if (kind !== "all") logQuery = logQuery.eq("kind", kind);
  const { data: logRaw } = await logQuery;
  const log = (logRaw ?? []) as OutboxRow[];

  const connected = connStatus?.connected ?? false;
  const qrData = connStatus?.qr_data ?? null;
  const qrImage = !connected && qrData ? await QRCode.toDataURL(qrData, { width: 280, margin: 1 }) : null;

  return (
    <AppShell user={user} active="/whatsapp">
      <h1>WhatsApp connection</h1>
      <AutoRefresh intervalMs={3000} enabled={!connected} />
      <div className="filters">
        <Link className="btn ghost" href="/whatsapp/settings">Settings</Link>
        <Link className="btn ghost" href="/whatsapp/send">Send targeted message</Link>
      </div>

      <div className="card" style={{ maxWidth: 420, marginTop: 14 }}>
        {connected ? (
          <>
            <h2 style={{ color: "var(--accent)" }}>Connected</h2>
            <p className="muted">
              Linked to {connStatus?.connected_number ?? "a WhatsApp number"}. Notifications (payment updates,
              complaint updates, notices) will send automatically from now on.
            </p>
          </>
        ) : qrImage ? (
          <>
            <h2>Scan to connect</h2>
            <p className="muted" style={{ marginBottom: 14 }}>
              On the phone you want to send messages from: WhatsApp → Settings → Linked Devices → Link a device,
              then scan this code.
            </p>
            <img
              src={qrImage}
              alt="WhatsApp QR code"
              width={280}
              height={280}
              style={{ display: "block", margin: "0 auto", borderRadius: "var(--radius-md)" }}
            />
            <p className="muted" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>
              This page checks for updates automatically every few seconds.
            </p>
          </>
        ) : (
          <>
            <h2>Not connected</h2>
            <p className="muted">
              The WhatsApp bot isn&apos;t running yet. Start it (see <code>whatsapp-bot/README.md</code>) and a QR
              code will appear here to scan.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2>Message log</h2>
        <div className="filters">
          <form method="get" className="filters" style={{ margin: 0 }} key={`${status}-${kind}`}>
            <select name="status" defaultValue={status}>
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select name="kind" defaultValue={kind}>
              <option value="all">All types</option>
              {Object.entries(KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <button className="btn ghost" type="submit">View</button>
          </form>
        </div>
        {log.length === 0 ? (
          <p className="muted">No messages match this filter.</p>
        ) : (
          <div className="tablewrap"><table>
            <thead><tr><th>To</th><th>Type</th><th>Message</th><th>Status</th><th>Sent</th></tr></thead>
            <tbody>
              {log.map((row) => (
                <tr key={row.id}>
                  <td>{row.to_number}</td>
                  <td>{KIND_LABEL[row.kind] ?? row.kind}</td>
                  <td style={{ maxWidth: 260 }}>{row.message}</td>
                  <td>
                    {row.status === "sent" && <span className="badge paid">Sent</span>}
                    {row.status === "pending" && (
                      <>
                        <span className="badge pending">Pending</span>
                        {new Date(row.scheduled_at).getTime() > Date.now() && (
                          <div className="rowsub">
                            Scheduled for {new Date(row.scheduled_at).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                          </div>
                        )}
                      </>
                    )}
                    {row.status === "failed" && (
                      <span className="badge unpaid" title={row.error ?? ""}>Failed</span>
                    )}
                    {row.status === "cancelled" && <span className="badge off">Cancelled</span>}
                  </td>
                  <td className="rowsub">
                    {row.sent_at
                      ? new Date(row.sent_at).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </AppShell>
  );
}
