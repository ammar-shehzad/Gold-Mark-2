import AppHeader from "@/components/AppHeader";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { money } from "@/lib/util";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

async function saveShop(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = await supabaseServer();
  const id = Number(formData.get("id") || 0);
  const fee = Number(formData.get("monthly_fee") || 0);
  const row = {
    shop_number: String(formData.get("shop_number") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    owner_name: String(formData.get("owner_name") || "").trim() || null,
    owner_phone: String(formData.get("owner_phone") || "").trim() || null,
    floor_id: Number(formData.get("floor_id")),
    size_sqft: formData.get("size_sqft") ? Number(formData.get("size_sqft")) : null,
    custom_fee: fee,
    active: formData.get("active") === "on",
  };
  if (!row.shop_number || !row.name || !row.floor_id || fee <= 0) {
    redirect(`/shops?${id ? `edit=${id}` : "new=1"}&err=missing`);
  }
  const q = id
    ? supabase.from("shops").update(row).eq("id", id)
    : supabase.from("shops").insert(row);
  const { error } = await q;
  if (error) redirect(`/shops?${id ? `edit=${id}` : "new=1"}&err=duplicate`);
  redirect("/shops?ok=1");
}

export default async function ShopsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; edit?: string; q?: string; floor?: string; err?: string; ok?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const supabase = await supabaseServer();

  const { data: floors } = await supabase.from("floors").select("*").order("sort").order("name");

  let editing: Record<string, unknown> | null = null;
  if (sp.edit) {
    const { data } = await supabase.from("shops").select("*").eq("id", Number(sp.edit)).single();
    editing = data;
  }
  const showForm = sp.new === "1" || !!editing;

  let shops: Record<string, unknown>[] = [];
  if (!showForm) {
    const { data } = await supabase.from("shops").select("*, floors(name,sort)").order("shop_number");
    shops = (data ?? []) as Record<string, unknown>[];
    if (sp.floor) shops = shops.filter(s => Number(s.floor_id) === Number(sp.floor));
    if (sp.q) {
      const needle = sp.q.toLowerCase();
      shops = shops.filter(s =>
        String(s.shop_number).toLowerCase().includes(needle) ||
        String(s.name).toLowerCase().includes(needle) ||
        String(s.owner_name ?? "").toLowerCase().includes(needle)
      );
    }
  }

  const v = (k: string) => (editing?.[k] ?? "") as string | number;

  return (
    <>
      <AppHeader user={user} active="/shops" />
      <main className="wrap">
        <h1>{showForm ? (editing ? "Edit shop" : "Register shop") : "Shops"}</h1>
        {sp.err === "duplicate" && <div className="flash err">That shop number already exists — use a different one.</div>}
        {sp.err === "missing" && <div className="flash err">Shop number, name, floor, and a monthly fee above zero are required.</div>}
        {sp.ok && <div className="flash ok">Shop saved.</div>}

        {showForm ? (
          <div className="card" style={{ maxWidth: 560, marginTop: 14 }}>
            <form action={saveShop}>
              {editing && <input type="hidden" name="id" value={Number(editing.id)} />}
              <div className="frow">
                <div className="field">
                  <label>Shop number</label>
                  <input type="text" name="shop_number" defaultValue={v("shop_number")} placeholder="G-15" required />
                </div>
                <div className="field">
                  <label>Floor</label>
                  <select name="floor_id" defaultValue={String(v("floor_id") || floors?.[0]?.id || "")} required>
                    {(floors ?? []).map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Shop name</label>
                <input type="text" name="name" defaultValue={v("name")} placeholder="Style Hub Garments" required />
              </div>
              <div className="frow">
                <div className="field">
                  <label>Owner name</label>
                  <input type="text" name="owner_name" defaultValue={v("owner_name")} />
                </div>
                <div className="field">
                  <label>Owner phone</label>
                  <input type="text" name="owner_phone" defaultValue={v("owner_phone")} placeholder="0300 1234567" />
                </div>
              </div>
              <div className="frow">
                <div className="field">
                  <label>Size (sq ft) <span className="muted">(optional)</span></label>
                  <input type="number" name="size_sqft" min="0" defaultValue={v("size_sqft")} />
                </div>
                <div className="field">
                  <label>Monthly maintenance fee</label>
                  <input type="number" step="0.01" min="1" name="monthly_fee"
                    defaultValue={v("custom_fee")} placeholder="6500" required />
                </div>
              </div>
              <div className="field">
                <label>
                  <input type="checkbox" name="active" style={{ width: "auto" }}
                    defaultChecked={editing ? Boolean(editing.active) : true} />{" "}
                  Shop is active (gets a monthly invoice)
                </label>
              </div>
              <button className="btn">{editing ? "Save changes" : "Register shop"}</button>{" "}
              <Link className="btn ghost" href="/shops">Cancel</Link>
            </form>
          </div>
        ) : (
          <>
            <div className="filters">
              <form method="get" className="filters" style={{ margin: 0 }} key={`${sp.q ?? ""}-${sp.floor ?? ""}`}>
                <input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="Search shop, owner…" />
                <select name="floor" defaultValue={sp.floor ?? ""}>
                  <option value="">All floors</option>
                  {(floors ?? []).map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                <button className="btn ghost" type="submit">Search</button>
              </form>
              <Link className="btn" href="/shops?new=1" style={{ marginLeft: "auto" }}>+ Register shop</Link>
            </div>
            <div className="card">
              {shops.length === 0 ? (
                <p className="muted">No shops yet. Register your first shop to get started.</p>
              ) : (
                <div className="tablewrap"><table>
                  <thead>
                    <tr><th>Shop</th><th>Floor</th><th>Owner</th><th className="r">Monthly fee</th><th /></tr>
                  </thead>
                  <tbody>
                    {shops.map(s => (
                      <tr key={String(s.id)}>
                        <td>
                          <strong>{String(s.shop_number)}</strong> · {String(s.name)}
                          {!s.active && <> <span className="badge off">inactive</span></>}
                          {s.size_sqft != null && <div className="rowsub">{Number(s.size_sqft)} sq ft</div>}
                        </td>
                        <td>{(s.floors as { name: string }).name}</td>
                        <td>
                          {String(s.owner_name ?? "—") || "—"}
                          {Boolean(s.owner_phone) && <div className="rowsub">{String(s.owner_phone)}</div>}
                        </td>
                        <td className="r num">{money(Number(s.custom_fee ?? 0))}</td>
                        <td className="r">
                          <Link className="btn ghost small" href={`/shops?edit=${s.id}`}>Edit</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          </>
        )}
      </main>
      <footer className="wrap foot muted">MallPay maintenance collection</footer>
    </>
  );
}
