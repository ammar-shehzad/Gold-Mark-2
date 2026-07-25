import AppShell from "@/components/AppShell";
import PendingButton from "@/components/PendingButton";
import ConfirmButton from "@/components/ConfirmButton";
import BulkCollectPanel from "@/components/BulkCollectPanel";
import { requireStaff } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { money, currentPeriod, periodLabel } from "@/lib/util";
import { cancelPendingReminders } from "@/lib/reminders";
import { renderTemplate } from "@/lib/template";
import { logAudit } from "@/lib/audit";
import { redirect } from "next/navigation";
import { after } from "next/server";

export const dynamic = "force-dynamic";

// Finds or creates the invoice for (shop, period) at the shop's current fee,
// then returns its id + current status. Uses the service-role client so it
// works for any month (advance/backfill) regardless of the caller's RLS.
async function findOrCreateInvoice(admin: ReturnType<typeof supabaseAdmin>, shopId: number, period: string) {
  const { data: existing } = await admin
    .from("invoices").select("id,status,amount").eq("shop_id", shopId).eq("period", period).maybeSingle();
  if (existing) return existing as { id: number; status: string; amount: number };
  const { data: shop } = await admin.from("shops").select("custom_fee").eq("id", shopId).single();
  const { data: created } = await admin
    .from("invoices")
    .insert({ shop_id: shopId, period, amount: shop?.custom_fee ?? 0, status: "unpaid" })
    .select("id,status,amount").single();
  return created as { id: number; status: string; amount: number };
}

// Queues the "payment received" WhatsApp receipt for a paid invoice. Runs in
// after() so the collector never waits on it.
function queueReceipt(invoiceId: number) {
  after(async () => {
    const admin = supabaseAdmin();
    const { data: invoice } = await admin
      .from("invoices").select("period,amount,shop_id,shops(shop_number)").eq("id", invoiceId).single();
    if (!invoice) return;
    const { data: links } = await admin.from("mallpay_shop_owners").select("owner_id").eq("shop_id", invoice.shop_id);
    const ownerIds = (links ?? []).map((l) => l.owner_id);
    if (ownerIds.length === 0) return;
    const { data: owners } = await admin
      .from("profiles").select("whatsapp_number").in("id", ownerIds).eq("notify_whatsapp", true).not("whatsapp_number", "is", null);
    const recipients = (owners ?? []).filter((o) => o.whatsapp_number);
    if (recipients.length === 0) return;
    const shop = invoice.shops as unknown as { shop_number: string };
    const { data: tmpl } = await admin.from("mallpay_whatsapp_templates").select("body").eq("key", "payment_approved").single();
    const message = renderTemplate(
      tmpl?.body ?? "Your payment has been received and verified successfully. Shop {{shop_number}}, {{period_label}}, {{amount}}. Thank you.",
      { shop_number: shop.shop_number, period_label: periodLabel(invoice.period), amount: money(invoice.amount) }
    );
    await admin.from("mallpay_whatsapp_outbox").insert(
      recipients.map((o) => ({ to_number: o.whatsapp_number as string, message, kind: "payment_approved" as const, related_table: "invoices", related_id: invoiceId }))
    );
  });
}

async function collectOne(formData: FormData) {
  "use server";
  const user = await requireStaff();
  const shopId = Number(formData.get("shop_id"));
  const period = String(formData.get("period") || currentPeriod());
  const admin = supabaseAdmin();

  const inv = await findOrCreateInvoice(admin, shopId, period);
  if (inv.status !== "paid") {
    const paidAt = new Date().toISOString();
    await admin.from("invoices").update({ status: "paid", paid_at: paidAt, collected_by: user.id }).eq("id", inv.id).eq("status", "unpaid");
    const { data: shop } = await admin.from("shops").select("shop_number").eq("id", shopId).single();
    await logAudit({
      invoice_id: inv.id, shop_number: shop?.shop_number ?? null, period,
      action: period > currentPeriod() ? "advance_collect" : "collect",
      old_status: "unpaid", new_status: "paid", new_amount: inv.amount, new_paid_at: paidAt, changed_by: user.id,
    });
    await cancelPendingReminders(inv.id);
    queueReceipt(inv.id);
  }
  redirect(`/collect?period=${period}&ok=1`);
}

async function bulkCollect(formData: FormData) {
  "use server";
  const user = await requireStaff();
  const period = String(formData.get("period") || currentPeriod());
  const shopIds = formData.getAll("shop_ids").map(Number).filter(Boolean);
  if (shopIds.length === 0) redirect(`/collect?period=${period}`);
  const admin = supabaseAdmin();
  const paidAt = new Date().toISOString();

  let count = 0;
  for (const shopId of shopIds) {
    const inv = await findOrCreateInvoice(admin, shopId, period);
    if (inv.status === "paid") continue;
    await admin.from("invoices").update({ status: "paid", paid_at: paidAt, collected_by: user.id }).eq("id", inv.id).eq("status", "unpaid");
    await cancelPendingReminders(inv.id);
    queueReceipt(inv.id);
    count++;
  }
  await logAudit({ period, action: "bulk_collect", new_status: "paid", new_paid_at: paidAt, changed_by: user.id, note: `${count} shop(s) collected` });
  redirect(`/collect?period=${period}&ok=bulk:${count}`);
}

async function undoCollection(formData: FormData) {
  "use server";
  const user = await requireStaff();
  if (user.role !== "admin") redirect("/collect");
  const invoiceId = Number(formData.get("invoice_id"));
  const period = String(formData.get("period") || currentPeriod());
  const admin = supabaseAdmin();
  const { data: before } = await admin.from("invoices").select("status,amount,paid_at,shop_id,shops(shop_number)").eq("id", invoiceId).single();
  await admin.from("invoices").update({ status: "unpaid", paid_at: null, collected_by: null }).eq("id", invoiceId);
  await logAudit({
    invoice_id: invoiceId, shop_number: (before?.shops as unknown as { shop_number: string })?.shop_number ?? null, period,
    action: "undo", old_status: before?.status ?? "paid", new_status: "unpaid", old_amount: before?.amount ?? null, old_paid_at: before?.paid_at ?? null, changed_by: user.id,
  });
  redirect(`/collect?period=${period}&ok=undo`);
}

async function editCollection(formData: FormData) {
  "use server";
  const user = await requireStaff();
  if (user.role !== "admin") redirect("/collect");
  const invoiceId = Number(formData.get("invoice_id"));
  const period = String(formData.get("period") || currentPeriod());
  const amount = Number(formData.get("amount") || 0);
  const paidOn = String(formData.get("paid_on") || "").trim();
  const admin = supabaseAdmin();
  const { data: before } = await admin.from("invoices").select("amount,paid_at,shop_id,shops(shop_number)").eq("id", invoiceId).single();
  const patch: Record<string, unknown> = {};
  if (amount > 0) patch.amount = amount;
  if (paidOn) patch.paid_at = new Date(paidOn + "T12:00:00").toISOString();
  if (Object.keys(patch).length > 0) {
    await admin.from("invoices").update(patch).eq("id", invoiceId);
    await logAudit({
      invoice_id: invoiceId, shop_number: (before?.shops as unknown as { shop_number: string })?.shop_number ?? null, period,
      action: "edit", old_amount: before?.amount ?? null, new_amount: amount > 0 ? amount : (before?.amount ?? null),
      old_paid_at: before?.paid_at ?? null, new_paid_at: (patch.paid_at as string) ?? before?.paid_at ?? null, changed_by: user.id,
    });
  }
  redirect(`/collect?period=${period}&ok=edit`);
}

type Shop = { id: number; shop_number: string; name: string; floor_id: number; custom_fee: number; owner_name: string | null; floors: { name: string } };
type Inv = { id: number; shop_id: number; amount: number; status: string; paid_at: string | null; profiles: { name: string } | null };

export default async function CollectPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; floor?: string; show?: string; q?: string; bulk?: string; edit?: string; ok?: string }>;
}) {
  const user = await requireStaff();
  if (user.role === "staff" && user.staff_type === "department") redirect("/complaints");
  const sp = await searchParams;
  const current = currentPeriod();
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "") ? sp.period! : current;
  const supabase = await supabaseServer();

  // Ensure invoices exist for the current month always, and for the viewed
  // month when it's not in the future (past/current). Future months stay
  // sparse - an invoice only appears there once an advance payment is made.
  await supabase.rpc("ensure_invoices", { p_period: current });
  if (period < current) await supabase.rpc("ensure_invoices", { p_period: period });

  const show = ["all", "pending", "paid"].includes(sp.show ?? "") ? sp.show! : "pending";
  const floorId = sp.floor ? Number(sp.floor) : 0;
  const bulk = sp.bulk === "1";

  const [{ data: shopsRaw }, { data: invsRaw }, { data: arrearsRaw }, { data: floors }] = await Promise.all([
    supabase.from("shops").select("id,shop_number,name,floor_id,custom_fee,owner_name,floors(name)").eq("active", true).order("shop_number"),
    supabase.from("invoices").select("id,shop_id,amount,status,paid_at,profiles:collected_by(name)").eq("period", period),
    supabase.from("invoices").select("shop_id,amount").eq("status", "unpaid").lt("period", current),
    supabase.from("floors").select("*").order("sort").order("name"),
  ]);

  const shops = (shopsRaw ?? []) as unknown as Shop[];
  const invByShop = new Map<number, Inv>();
  for (const i of (invsRaw ?? []) as unknown as Inv[]) invByShop.set(i.shop_id, i);
  const arrearsByShop = new Map<number, { count: number; total: number }>();
  for (const a of (arrearsRaw ?? []) as { shop_id: number; amount: number }[]) {
    const e = arrearsByShop.get(a.shop_id) ?? { count: 0, total: 0 };
    e.count++; e.total += Number(a.amount);
    arrearsByShop.set(a.shop_id, e);
  }

  let rows = shops.map((s) => {
    const inv = invByShop.get(s.id);
    return { shop: s, inv, paid: inv?.status === "paid", arrears: arrearsByShop.get(s.id) };
  });
  if (floorId) rows = rows.filter((r) => r.shop.floor_id === floorId);
  if (sp.q) {
    const n = sp.q.toLowerCase();
    rows = rows.filter((r) => r.shop.shop_number.toLowerCase().includes(n) || r.shop.name.toLowerCase().includes(n));
  }
  if (show === "pending") rows = rows.filter((r) => !r.paid);
  else if (show === "paid") rows = rows.filter((r) => r.paid);

  const paidCount = shops.filter((s) => invByShop.get(s.id)?.status === "paid").length;
  const collectedTotal = shops.reduce((sum, s) => {
    const inv = invByShop.get(s.id);
    return inv?.status === "paid" ? sum + Number(inv.amount) : sum;
  }, 0);
  const isFuture = period > current;

  const pendingForBulk = rows.filter((r) => !r.paid).map((r) => ({ shop_id: r.shop.id, shop_number: r.shop.shop_number, name: r.shop.name }));

  const editRow = sp.edit ? rows.find((r) => r.inv?.id === Number(sp.edit)) : undefined;

  return (
    <AppShell user={user} active="/collect">
      <h1>Collect · {periodLabel(period)}{isFuture && <span className="badge off" style={{ marginLeft: 8, verticalAlign: "middle" }}>advance</span>}</h1>
      {sp.ok === "1" && <div className="flash ok">Payment recorded.</div>}
      {sp.ok === "undo" && <div className="flash ok">Collection reverted to pending.</div>}
      {sp.ok === "edit" && <div className="flash ok">Collection updated.</div>}
      {sp.ok?.startsWith("bulk:") && <div className="flash ok">Bulk collection done — {sp.ok.slice(5)} shop(s) marked collected.</div>}

      <div className="grid c4" style={{ marginTop: 14 }}>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">Collected · {periodLabel(period)}</div><div className="kpi-value">{money(collectedTotal)}</div></div></div>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">Shops paid</div><div className="kpi-value">{paidCount} / {shops.length}</div></div></div>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">Still pending</div><div className="kpi-value">{shops.length - paidCount}</div></div></div>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">View</div><div className="kpi-value" style={{ fontSize: 15 }}>{isFuture ? "Future (advance)" : period === current ? "Current month" : "Past month"}</div></div></div>
      </div>

      <div className="filters" style={{ marginTop: 6 }}>
        <form method="get" className="filters" style={{ margin: 0 }} key={`${period}-${floorId}-${show}-${sp.q ?? ""}`}>
          <input type="month" name="period" defaultValue={period} title="Pick any month — past, current, or a future month for advance payments" />
          <select name="show" defaultValue={show}>
            <option value="pending">Pending only</option>
            <option value="paid">Paid only</option>
            <option value="all">All shops</option>
          </select>
          <select name="floor" defaultValue={floorId ? String(floorId) : ""}>
            <option value="">All floors</option>
            {(floors ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="Shop number or name" />
          <button className="btn ghost" type="submit">View</button>
        </form>
        {bulk ? (
          <a className="btn ghost" href={`/collect?period=${period}`} style={{ marginLeft: "auto" }}>Exit bulk mode</a>
        ) : (
          <a className="btn" href={`/collect?period=${period}&bulk=1`} style={{ marginLeft: "auto" }}>Bulk Collection</a>
        )}
      </div>

      {bulk ? (
        <BulkCollectPanel shops={pendingForBulk} period={period} periodLabel={periodLabel(period)} action={bulkCollect} />
      ) : (
        <>
          {editRow && editRow.inv && user.role === "admin" && (
            <div className="card" style={{ maxWidth: 480 }}>
              <h2>Edit collection · {editRow.shop.shop_number}</h2>
              <form action={editCollection}>
                <input type="hidden" name="invoice_id" value={editRow.inv.id} />
                <input type="hidden" name="period" value={period} />
                <div className="frow">
                  <div className="field"><label>Amount</label><input type="number" step="0.01" min="0" name="amount" defaultValue={String(editRow.inv.amount)} /></div>
                  <div className="field"><label>Paid on</label><input type="date" name="paid_on" defaultValue={editRow.inv.paid_at ? editRow.inv.paid_at.slice(0, 10) : ""} /></div>
                </div>
                <PendingButton className="btn" pendingText="Saving…">Save changes</PendingButton>{" "}
                <a className="btn ghost" href={`/collect?period=${period}`}>Cancel</a>
              </form>
            </div>
          )}

          <div className="card">
            {rows.length === 0 ? (
              <p className="muted">{show === "pending" ? `Nothing pending for ${periodLabel(period)}.` : "No shops match this filter."}</p>
            ) : (
              <div className="tablewrap"><table>
                <thead><tr><th>Shop</th><th>Action</th><th className="r">Amount</th><th className="r">Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.shop.id}>
                      <td>
                        <strong>{r.shop.shop_number}</strong> · {r.shop.name}
                        <div className="rowsub">{r.shop.floors.name}{r.shop.owner_name && r.shop.owner_name !== "No Owner" ? ` · ${r.shop.owner_name}` : ""}</div>
                        {r.arrears && r.arrears.count > 0 && (
                          <div className="rowsub" style={{ color: "var(--danger)", fontWeight: 600 }}>Arrears: {money(r.arrears.total)} · {r.arrears.count} month(s)</div>
                        )}
                      </td>
                      <td>
                        {r.paid ? (
                          user.role === "admin" ? (
                            <span className="row-actions">
                              <a className="btn ghost small" href={`/collect?period=${period}&edit=${r.inv!.id}`}>Edit</a>
                              <form action={undoCollection} style={{ display: "inline" }}>
                                <input type="hidden" name="invoice_id" value={r.inv!.id} />
                                <input type="hidden" name="period" value={period} />
                                <ConfirmButton className="btn ghost small" message={`Undo the collection for ${r.shop.shop_number} (${periodLabel(period)})? It goes back to pending.`} pendingText="Undoing…">Undo</ConfirmButton>
                              </form>
                            </span>
                          ) : <span className="muted">-</span>
                        ) : (
                          <form action={collectOne} style={{ display: "inline" }}>
                            <input type="hidden" name="shop_id" value={r.shop.id} />
                            <input type="hidden" name="period" value={period} />
                            <PendingButton className="btn small" pendingText="Collecting…">{isFuture ? "Collect (advance)" : "Mark collected"}</PendingButton>
                          </form>
                        )}
                      </td>
                      <td className="r num">{money(r.inv?.amount ?? r.shop.custom_fee)}</td>
                      <td className="r">
                        {r.paid ? (
                          <>
                            <span className="badge paid">Paid</span>
                            <div className="rowsub">{r.inv?.paid_at && new Date(r.inv.paid_at).toLocaleDateString("en-US", { day: "numeric", month: "short" })}{" · "}{r.inv?.profiles?.name ?? "-"}</div>
                          </>
                        ) : <span className="badge unpaid">Pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </>
      )}

      {user.role === "staff" && (
        <p className="muted" style={{ fontSize: 13 }}>
          You&apos;re on a collector account. Pick any month above to collect - including a future month for advance payments. Totals and reports are visible to the administrator.
        </p>
      )}
    </AppShell>
  );
}
