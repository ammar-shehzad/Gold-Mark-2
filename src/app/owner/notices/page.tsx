import AppShell from "@/components/AppShell";
import { requireOwner } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Notice = { id: number; title: string; body: string; created_at: string };

export default async function OwnerNoticesPage() {
  const user = await requireOwner();
  const supabase = await supabaseServer();
  const { data } = await supabase.from("mallpay_notices").select("*").order("created_at", { ascending: false });
  const notices = (data ?? []) as Notice[];

  return (
    <AppShell user={user} active="/owner/notices">
      <h1>Notices</h1>
      {notices.length === 0 ? (
        <div className="card"><p className="muted">No notices yet.</p></div>
      ) : (
        notices.map((n) => (
          <div className="card" key={n.id}>
            <h2>{n.title}</h2>
            <p style={{ whiteSpace: "pre-wrap", margin: "0 0 8px" }}>{n.body}</p>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              {new Date(n.created_at).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
        ))
      )}
    </AppShell>
  );
}
