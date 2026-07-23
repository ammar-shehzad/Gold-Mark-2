import AppShell from "@/components/AppShell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { renderTemplate } from "@/lib/template";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function postNotice(formData: FormData) {
  "use server";
  const user = await requireAdmin();
  const supabase = await supabaseServer();
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const delayMinutes = Number(formData.get("delay_minutes") || 0);
  if (!title || !body) redirect("/notices?err=1");

  const { error } = await supabase.from("mallpay_notices").insert({ title, body, created_by: user.id });
  if (error) redirect("/notices?err=1");

  const { data: owners } = await supabase
    .from("profiles")
    .select("whatsapp_number")
    .eq("role", "owner")
    .eq("active", true)
    .eq("notify_whatsapp", true)
    .not("whatsapp_number", "is", null);

  const recipients = (owners ?? []).filter((o) => o.whatsapp_number);
  if (recipients.length > 0) {
    const { data: tmpl } = await supabase.from("mallpay_whatsapp_templates").select("body").eq("key", "notice").single();
    const message = renderTemplate(tmpl?.body ?? "{{title}}\n\n{{body}}", { title, body });
    // Every recipient shares the exact same scheduled_at, so the bot
    // releases the whole batch together instead of staggering them by
    // insert order.
    const scheduledAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
    await supabase.from("mallpay_whatsapp_outbox").insert(
      recipients.map((o) => ({
        to_number: o.whatsapp_number as string,
        message,
        kind: "notice" as const,
        scheduled_at: scheduledAt,
      }))
    );
  }
  redirect("/notices?ok=1");
}

type Notice = { id: number; title: string; body: string; created_at: string; profiles: { name: string } | null };

export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("mallpay_notices")
    .select("id,title,body,created_at,profiles:created_by(name)")
    .order("created_at", { ascending: false });
  const notices = (data ?? []) as unknown as Notice[];

  return (
    <AppShell user={user} active="/notices">
      <h1>Notices</h1>
      {sp.err && <div className="flash err">Title and body are required.</div>}
      {sp.ok && <div className="flash ok">Notice sent to all owners.</div>}

      <div className="card" style={{ maxWidth: 560, marginTop: 14 }}>
        <h2>New announcement</h2>
        <form action={postNotice}>
          <div className="field">
            <label>Title</label>
            <input type="text" name="title" placeholder="Water shutdown on Friday" required />
          </div>
          <div className="field">
            <label>Message</label>
            <textarea name="body" rows={4} placeholder="Water will be shut off from 10am-2pm for maintenance." required />
          </div>
          <div className="field">
            <label>WhatsApp delivery</label>
            <select name="delay_minutes" defaultValue="0">
              <option value="0">Send now</option>
              <option value="5">In 5 minutes</option>
              <option value="15">In 15 minutes</option>
              <option value="30">In 30 minutes</option>
              <option value="60">In 1 hour</option>
              <option value="180">In 3 hours</option>
            </select>
            <p className="muted" style={{ fontSize: 13, marginTop: 4, marginBottom: 0 }}>
              Every owner gets the WhatsApp message at exactly this time, together - not one after another.
            </p>
          </div>
          <button className="btn">Send to all owners</button>
        </form>
      </div>

      <div className="card">
        {notices.length === 0 ? (
          <p className="muted">No notices sent yet.</p>
        ) : (
          <div className="tablewrap"><table>
            <thead><tr><th>Title</th><th>By</th><th>Date</th></tr></thead>
            <tbody>
              {notices.map((n) => (
                <tr key={n.id}>
                  <td><strong>{n.title}</strong><div className="rowsub">{n.body}</div></td>
                  <td>{n.profiles?.name ?? "-"}</td>
                  <td>{new Date(n.created_at).toLocaleDateString("en-US", { day: "numeric", month: "short" })}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </AppShell>
  );
}
