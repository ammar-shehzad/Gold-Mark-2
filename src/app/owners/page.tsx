import AppShell from "@/components/AppShell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Re-derives a shop's owner_name/owner_phone from whichever owner (if any)
// is currently linked to it in mallpay_shop_owners — keeps the shops table
// in sync whenever an owner is linked, unlinked, or created.
async function syncShopOwnerFields(shopId: number) {
  const supabase = await supabaseServer();
  const { data: link } = await supabase
    .from("mallpay_shop_owners")
    .select("owner_id")
    .eq("shop_id", shopId)
    .limit(1)
    .maybeSingle();
  if (link) {
    const { data: owner } = await supabase
      .from("profiles").select("name,whatsapp_number").eq("id", link.owner_id).single();
    await supabase.from("shops").update({
      owner_name: owner?.name ?? "No Owner",
      owner_phone: owner?.whatsapp_number ?? null,
    }).eq("id", shopId);
  } else {
    await supabase.from("shops").update({ owner_name: "No Owner", owner_phone: null }).eq("id", shopId);
  }
}

async function createOwner(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("o_name") || "").trim();
  const email = String(formData.get("o_email") || "").trim();
  const password = String(formData.get("o_password") || "");
  const whatsapp = String(formData.get("o_whatsapp") || "").trim() || null;
  const shopIds = formData.getAll("o_shop_ids").map(Number).filter(Boolean);

  if (!name || !email || password.length < 6) {
    redirect("/owners?new=1&err=Owner+needs+a+name,+email,+and+a+password+of+at+least+6+characters");
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name },
  });
  if (error || !data.user) redirect("/owners?new=1&err=Could+not+create+the+account+—+is+the+email+already+used%3F");

  await admin.from("profiles").update({ name, role: "owner", whatsapp_number: whatsapp }).eq("id", data.user.id);
  if (shopIds.length > 0) {
    await admin.from("mallpay_shop_owners").insert(shopIds.map((id) => ({ shop_id: id, owner_id: data.user.id })));
    for (const shopId of shopIds) await syncShopOwnerFields(shopId);
  }
  redirect("/owners?ok=Owner+account+created");
}

async function toggleOwner(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const supabase = await supabaseServer();
  const { data: target } = await supabase.from("profiles").select("active").eq("id", id).single();
  if (target) await supabase.from("profiles").update({ active: !target.active }).eq("id", id);
  redirect("/owners?ok=Account+updated");
}

async function linkShop(formData: FormData) {
  "use server";
  await requireAdmin();
  const ownerId = String(formData.get("owner_id"));
  const shopId = Number(formData.get("shop_id"));
  const supabase = await supabaseServer();
  if (shopId) {
    await supabase.from("mallpay_shop_owners").insert({ shop_id: shopId, owner_id: ownerId });
    await syncShopOwnerFields(shopId);
  }
  redirect("/owners?ok=Shop+linked");
}

async function unlinkShop(formData: FormData) {
  "use server";
  await requireAdmin();
  const ownerId = String(formData.get("owner_id"));
  const shopId = Number(formData.get("shop_id"));
  const supabase = await supabaseServer();
  await supabase.from("mallpay_shop_owners").delete().eq("owner_id", ownerId).eq("shop_id", shopId);
  await syncShopOwnerFields(shopId);
  redirect("/owners?ok=Shop+unlinked");
}

type Shop = { id: number; shop_number: string; name: string };
type OwnerProfile = { id: string; name: string; whatsapp_number: string | null; active: boolean };

export default async function OwnersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string; new?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const supabase = await supabaseServer();
  const showForm = sp.new === "1";

  const [{ data: owners }, { data: shops }, { data: links }] = await Promise.all([
    supabase.from("profiles").select("id,name,whatsapp_number,active").eq("role", "owner").order("name"),
    supabase.from("shops").select("id,shop_number,name").order("shop_number"),
    supabase.from("mallpay_shop_owners").select("shop_id,owner_id"),
  ]);

  const shopsById = new Map((shops ?? []).map((s) => [s.id, s as Shop]));
  const shopsByOwner = new Map<string, Shop[]>();
  for (const l of links ?? []) {
    const shop = shopsById.get(l.shop_id);
    if (!shop) continue;
    shopsByOwner.set(l.owner_id, [...(shopsByOwner.get(l.owner_id) ?? []), shop]);
  }

  return (
    <AppShell user={user} active="/owners">
      <h1>Owners</h1>
      {sp.ok && <div className="flash ok">{sp.ok}</div>}
      {sp.err && <div className="flash err">{sp.err}</div>}

      <div className="filters">
        {showForm ? (
          <Link className="btn ghost" href="/owners" style={{ marginLeft: "auto" }}>Cancel</Link>
        ) : (
          <Link className="btn" href="/owners?new=1" style={{ marginLeft: "auto" }}>+ Create new owner</Link>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ maxWidth: 560 }}>
          <h2>Create owner account</h2>
          <form action={createOwner}>
            <div className="frow">
              <div className="field"><label>Full name</label><input type="text" name="o_name" placeholder="Ahmed Khan" required /></div>
              <div className="field"><label>Email (their login)</label><input type="email" name="o_email" placeholder="ahmed@example.com" required /></div>
            </div>
            <div className="frow">
              <div className="field"><label>Password (min 6 characters)</label><input type="password" name="o_password" required /></div>
              <div className="field"><label>WhatsApp number</label><input type="text" name="o_whatsapp" placeholder="923001234567" /></div>
            </div>
            <div className="field">
              <label>Shops owned</label>
              <div className="tablewrap" style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", padding: 10 }}>
                {(shops ?? []).map((s) => (
                  <label key={s.id} style={{ display: "block", fontSize: 14, marginBottom: 4 }}>
                    <input type="checkbox" name="o_shop_ids" value={s.id} style={{ width: "auto", marginRight: 6 }} />
                    {s.shop_number} · {s.name}
                  </label>
                ))}
              </div>
            </div>
            <button className="btn">Create owner account</button>{" "}
            <Link className="btn ghost" href="/owners">Cancel</Link>
          </form>
        </div>
      )}

      <div className="card">
        <h2>Owner accounts</h2>
        {(owners ?? []).length === 0 ? (
          <p className="muted">No owner accounts yet — click &quot;+ Create new owner&quot; above.</p>
        ) : (
          <div className="tablewrap"><table>
            <thead><tr><th>Name</th><th>WhatsApp</th><th>Shops</th><th className="r" /></tr></thead>
            <tbody>
              {(owners as OwnerProfile[] ?? []).map((o) => (
                <tr key={o.id}>
                  <td>
                    {o.name}
                    {!o.active && <> <span className="badge off">disabled</span></>}
                  </td>
                  <td>{o.whatsapp_number ?? <span className="muted">—</span>}</td>
                  <td>
                    {(shopsByOwner.get(o.id) ?? []).map((s) => (
                      <span key={s.id} className="badge off" style={{ marginRight: 6 }}>
                        {s.shop_number}
                        <form action={unlinkShop} style={{ display: "inline" }}>
                          <input type="hidden" name="owner_id" value={o.id} />
                          <input type="hidden" name="shop_id" value={s.id} />
                          <button className="btn ghost small" style={{ padding: "0 4px", marginLeft: 4 }}>×</button>
                        </form>
                      </span>
                    ))}
                    <form action={linkShop} style={{ display: "inline-flex", gap: 4, marginTop: 4 }}>
                      <input type="hidden" name="owner_id" value={o.id} />
                      <select name="shop_id" style={{ width: "auto", minWidth: 120 }}>
                        {(shops ?? []).map((s) => (
                          <option key={s.id} value={s.id}>{s.shop_number}</option>
                        ))}
                      </select>
                      <button className="btn ghost small">+ Link</button>
                    </form>
                  </td>
                  <td className="r">
                    <form action={toggleOwner} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={o.id} />
                      <button className="btn ghost small">{o.active ? "Disable" : "Enable"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          
          </div>
        )}
      </div>
      
    </AppShell>
  );
}
