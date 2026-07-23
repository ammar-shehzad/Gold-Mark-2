import AppShell from "@/components/AppShell";
import { requireStaff } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { renderTemplate } from "@/lib/template";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const STATUSES = ["submitted", "assigned", "in_progress", "completed", "closed", "rejected"] as const;
const STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  closed: "Closed",
  rejected: "Rejected",
};

async function updateComplaintStatus(formData: FormData) {
  "use server";
  await requireStaff();
  const supabase = await supabaseServer();
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") || "");
  const adminNote = String(formData.get("admin_note") || "").trim() || null;

  const { data: complaint } = await supabase
    .from("mallpay_complaints")
    .select("category,shops(shop_number),profiles:owner_id(whatsapp_number,notify_whatsapp)")
    .eq("id", id)
    .single();

  await supabase.from("mallpay_complaints").update({ status, admin_note: adminNote, updated_at: new Date().toISOString() }).eq("id", id);

  const owner = complaint?.profiles as unknown as { whatsapp_number: string | null; notify_whatsapp: boolean } | null;
  const shop = complaint?.shops as unknown as { shop_number: string } | null;
  if (owner?.whatsapp_number && owner.notify_whatsapp) {
    const { data: tmpl } = await supabase.from("mallpay_whatsapp_templates").select("body").eq("key", "complaint_status").single();
    const message = renderTemplate(
      tmpl?.body ?? "Update on your {{category}} complaint (Shop {{shop_number}}): {{status_label}}.",
      { category: complaint?.category ?? "", shop_number: shop?.shop_number ?? "", status_label: STATUS_LABEL[status] ?? status }
    );
    await supabase.from("mallpay_whatsapp_outbox").insert({
      to_number: owner.whatsapp_number,
      message,
      kind: "complaint_status",
      related_table: "mallpay_complaints",
      related_id: id,
    });
  }
  redirect("/complaints?ok=1");
}

type Complaint = {
  id: number; category: string; description: string; status: string; admin_note: string | null; created_at: string;
  shops: { shop_number: string; name: string };
  profiles: { name: string } | null;
};

export default async function AdminComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; ok?: string }>;
}) {
  const user = await requireStaff();
  const sp = await searchParams;
  const supabase = await supabaseServer();

  let department: string | null = null;
  if (user.role === "staff") {
    const { data: profile } = await supabase.from("profiles").select("department").eq("id", user.id).single();
    department = profile?.department ?? null;
  }

  let query = supabase
    .from("mallpay_complaints")
    .select("id,category,description,status,admin_note,created_at,shops(shop_number,name),profiles:owner_id(name)")
    .order("created_at", { ascending: false });
  if (user.role === "staff") query = query.eq("category", department ?? "__none__");

  const { data } = await query;

  let complaints = (data ?? []) as unknown as Complaint[];
  if (sp.status) complaints = complaints.filter((c) => c.status === sp.status);

  return (
    <AppShell user={user} active="/complaints">
      <h1>Complaints</h1>
      {user.role === "staff" && (
        <p className="muted" style={{ marginTop: -8 }}>
          {department
            ? `Showing ${department} complaints only.`
            : "No department assigned to your account yet - ask the admin to set one in Setup."}
        </p>
      )}
      {sp.ok && <div className="flash ok">Updated.</div>}

      <div className="filters">
        <form method="get" className="filters" style={{ margin: 0 }} key={sp.status ?? ""}>
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          <button className="btn ghost" type="submit">Filter</button>
        </form>
      </div>

      <div className="card">
        {complaints.length === 0 ? (
          <p className="muted">No complaints match this filter.</p>
        ) : (
          <div className="tablewrap"><table>
            <thead><tr><th>Shop</th><th>Category</th><th>Description</th><th>Owner</th><th className="r">Status</th></tr></thead>
            <tbody>
              {complaints.map((c) => (
                <tr key={c.id}>
                  <td>{c.shops.shop_number} · {c.shops.name}</td>
                  <td>{c.category}</td>
                  <td style={{ maxWidth: 260 }}>{c.description}</td>
                  <td>{c.profiles?.name ?? "-"}</td>
                  <td className="r">
                    <form action={updateComplaintStatus}>
                      <input type="hidden" name="id" value={c.id} />
                      <select name="status" defaultValue={c.status} style={{ width: "auto", marginBottom: 4 }}>
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                      <br />
                      <input type="text" name="admin_note" defaultValue={c.admin_note ?? ""} placeholder="Note (optional)" style={{ width: 160, marginBottom: 4 }} />
                      <br />
                      <button className="btn ghost small">Update</button>
                    </form>
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
