import AppShell from "@/components/AppShell";
import { requireOwner } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { renderTemplate } from "@/lib/template";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  closed: "Closed",
  rejected: "Rejected",
};

async function submitComplaint(formData: FormData) {
  "use server";
  const user = await requireOwner();
  const supabase = await supabaseServer();
  const shopId = Number(formData.get("shop_id"));
  const category = String(formData.get("category") || "");
  const description = String(formData.get("description") || "").trim();
  const file = formData.get("photo") as File | null;

  if (!shopId || !category || !description) redirect("/owner/complaints?err=missing");

  let photoUrl: string | null = null;
  if (file && file.size > 0) {
    const path = `${user.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("complaint-photos").upload(path, file);
    if (upErr) redirect("/owner/complaints?err=upload");
    photoUrl = path;
  }

  const { data: complaint, error } = await supabase
    .from("mallpay_complaints")
    .insert({ shop_id: shopId, owner_id: user.id, category, description, photo_url: photoUrl })
    .select("id,shops(shop_number)")
    .single();
  if (error) redirect("/owner/complaints?err=save");

  // Notify the department's staff — uses the service-role client because
  // an owner's own session can't read other users' profiles (RLS), and
  // can't insert into the outbox (staff/admin only).
  const admin = supabaseAdmin();
  const { data: staffList } = await admin
    .from("profiles")
    .select("whatsapp_number")
    .eq("role", "staff")
    .eq("department", category)
    .eq("active", true)
    .eq("notify_whatsapp", true)
    .not("whatsapp_number", "is", null);

  const recipients = (staffList ?? []).filter((s) => s.whatsapp_number);
  if (recipients.length > 0) {
    const shopNumber = (complaint?.shops as unknown as { shop_number: string } | null)?.shop_number ?? "";
    const { data: tmpl } = await admin.from("mallpay_whatsapp_templates").select("body").eq("key", "complaint_new").single();
    const message = renderTemplate(
      tmpl?.body ?? "New {{category}} complaint — Shop {{shop_number}}: {{description}}",
      { category, shop_number: shopNumber, description }
    );
    await admin.from("mallpay_whatsapp_outbox").insert(
      recipients.map((s) => ({
        to_number: s.whatsapp_number as string,
        message,
        kind: "complaint_new" as const,
        related_table: "mallpay_complaints",
        related_id: complaint?.id ?? null,
        image_path: photoUrl,
      }))
    );
  }

  redirect("/owner/complaints?ok=1");
}

type Shop = { id: number; shop_number: string; name: string };
type Complaint = {
  id: number; category: string; description: string; status: string; created_at: string;
  shops: { shop_number: string; name: string };
};

export default async function OwnerComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const user = await requireOwner();
  const sp = await searchParams;
  const supabase = await supabaseServer();

  const [{ data: shopLinks }, { data: complaintsRaw }, { data: departments }] = await Promise.all([
    supabase.from("mallpay_shop_owners").select("shops(id,shop_number,name)").eq("owner_id", user.id),
    supabase
      .from("mallpay_complaints")
      .select("id,category,description,status,created_at,shops(shop_number,name)")
      .order("created_at", { ascending: false }),
    supabase.from("mallpay_departments").select("name").order("name"),
  ]);

  const shops = ((shopLinks ?? []) as unknown as { shops: Shop }[]).map((s) => s.shops);
  const complaints = (complaintsRaw ?? []) as unknown as Complaint[];

  return (
    <AppShell user={user} active="/owner/complaints">
      <h1>Complaints</h1>
      {sp.err === "missing" && <div className="flash err">Shop, category, and description are required.</div>}
      {sp.err === "upload" && <div className="flash err">Could not upload the photo — try again.</div>}
      {sp.err === "save" && <div className="flash err">Could not save the complaint — try again.</div>}
      {sp.ok === "1" && <div className="flash ok">Complaint submitted.</div>}

      <div className="card" style={{ maxWidth: 520, marginTop: 14 }}>
        <h2>New complaint</h2>
        {shops.length === 0 ? (
          <p className="muted">No shop is linked to your account yet — contact the admin.</p>
        ) : (
          <form action={submitComplaint}>
            <div className="frow">
              <div className="field">
                <label>Shop</label>
                <select name="shop_id" required>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>{s.shop_number} · {s.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Category</label>
                <select name="category" required>
                  {(departments ?? []).map((d) => (
                    <option key={d.name} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label>Description</label>
              <textarea name="description" rows={4} required />
            </div>
            <div className="field">
              <label>Photo <span className="muted">(optional)</span></label>
              <input type="file" name="photo" accept="image/*" />
            </div>
            <button className="btn">Submit complaint</button>
          </form>
        )}
      </div>

      <div className="card">
        {complaints.length === 0 ? (
          <p className="muted">No complaints yet.</p>
        ) : (
          <div className="tablewrap"><table>
            <thead><tr><th>Shop</th><th>Category</th><th>Description</th><th className="r">Status</th></tr></thead>
            <tbody>
              {complaints.map((c) => (
                <tr key={c.id}>
                  <td>{c.shops.shop_number} · {c.shops.name}</td>
                  <td>{c.category}</td>
                  <td>{c.description}</td>
                  <td className="r"><span className="badge off">{STATUS_LABEL[c.status] ?? c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </AppShell>
  );
}
