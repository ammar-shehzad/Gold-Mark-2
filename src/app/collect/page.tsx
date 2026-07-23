import AppShell from "@/components/AppShell";
import { requireStaff } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { money, currentPeriod, periodLabel } from "@/lib/util";
import { cancelPendingReminders } from "@/lib/reminders";
import { renderTemplate } from "@/lib/template";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function markPaid(formData: FormData) {
  "use server";
  const user = await requireStaff();
  const supabase = await supabaseServer();
  const invoiceId = Number(formData.get("invoice_id"));

  const { data: invoice } = await supabase
    .from("invoices")
    .select("period,amount,shop_id,shops(shop_number)")
    .eq("id", invoiceId)
    .single();

  await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString(), collected_by: user.id })
    .eq("id", invoiceId)
    .eq("status", "unpaid");
  await cancelPendingReminders(invoiceId);

  if (invoice) {
    const { data: links } = await supabase.from("mallpay_shop_owners").select("owner_id").eq("shop_id", invoice.shop_id);
    const ownerIds = (links ?? []).map((l) => l.owner_id);
    if (ownerIds.length > 0) {
      const { data: owners } = await supabase
        .from("profiles")
        .select("whatsapp_number")
        .in("id", ownerIds)
        .eq("notify_whatsapp", true)
        .not("whatsapp_number", "is", null);
      const recipients = (owners ?? []).filter((o) => o.whatsapp_number);
      if (recipients.length > 0) {
        const shop = invoice.shops as unknown as { shop_number: string };
        const { data: tmpl } = await supabase.from("mallpay_whatsapp_templates").select("body").eq("key", "payment_approved").single();
        const message = renderTemplate(
          tmpl?.body ?? "Your payment has been received and verified successfully. Shop {{shop_number}}, {{period_label}}, {{amount}}. Thank you.",
          { shop_number: shop.shop_number, period_label: periodLabel(invoice.period), amount: money(invoice.amount) }
        );
        await supabase.from("mallpay_whatsapp_outbox").insert(
          recipients.map((o) => ({
            to_number: o.whatsapp_number as string,
            message,
            kind: "payment_approved" as const,
            related_table: "invoices",
            related_id: invoiceId,
          }))
        );
      }
    }
  }

  redirect("/collect?ok=1");
}

async function undoPaid(formData: FormData) {
  "use server";
  const user = await requireStaff();
  if (user.role !== "admin") redirect("/collect");
  const supabase = await supabaseServer();
  await supabase
    .from("invoices")
    .update({ status: "unpaid", paid_at: null, collected_by: null })
    .eq("id", Number(formData.get("invoice_id")));
  redirect("/collect?ok=2");
}

type Row = {
  id: number; amount: number; status: string; paid_at: string | null; period: string;
  shops: { shop_number: string; name: string; owner_name: string | null; floor_id: number; floors: { name: string } };
  profiles: { name: string } | null;
};

export default async function CollectPage({
  searchParams,
}: {
  searchParams: Promise<{ floor?: string; show?: string; q?: string; ok?: string }>;
}) {
  const user = await requireStaff();
  if (user.role === "staff" && user.staff_type === "department") redirect("/complaints");
  const sp = await searchParams;
  const period = currentPeriod();
  const supabase = await supabaseServer();
  await supabase.rpc("ensure_invoices", { p_period: period });

  const show = ["due", "paid", "all"].includes(sp.show ?? "") ? sp.show! : "due";

  const floorId = sp.floor ? Number(sp.floor) : 0;

  const [{ data: rowsRaw }, { data: floors }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id,amount,status,paid_at,period,shops(shop_number,name,owner_name,floor_id,floors(name)),profiles:collected_by(name)")
      .lte("period", period)
      .order("period"),
    supabase.from("floors").select("*").order("sort").order("name"),
  ]);

  // filtering happens here, in plain code - reliable regardless of query quirks
  let rows = (rowsRaw ?? []) as unknown as Row[];
  if (show === "due") rows = rows.filter(r => r.status === "unpaid");
  else if (show === "paid") rows = rows.filter(r => r.status === "paid" && r.period === period);
  else rows = rows.filter(r => r.period === period || r.status === "unpaid");
  if (floorId) rows = rows.filter(r => r.shops.floor_id === floorId);
  if (sp.q) {
    const needle = sp.q.toLowerCase();
    rows = rows.filter(
      r => r.shops.shop_number.toLowerCase().includes(needle) || r.shops.name.toLowerCase().includes(needle)
    );
  }

  // group by shop so multi-month arrears sit together with a total
  const byShop = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.shops.shop_number;
    byShop.set(k, [...(byShop.get(k) ?? []), r]);
  }
  const groups = [...byShop.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <AppShell user={user} active="/collect">
        <h1>Collect - {periodLabel(period)}</h1>
        {sp.ok === "1" && <div className="flash ok">Payment recorded.</div>}
        {sp.ok === "2" && <div className="flash ok">Payment reverted to unpaid.</div>}

        <div className="filters" style={{ marginTop: 14 }}>
          <form method="get" className="filters" style={{ margin: 0 }} key={`${floorId}-${show}-${sp.q ?? ""}`}>
            <select name="floor" defaultValue={floorId ? String(floorId) : ""}>
              <option value="">All floors</option>
              {(floors ?? []).map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <select name="show" defaultValue={show}>
              <option value="due">Due (incl. old months)</option>
              <option value="paid">Paid this month</option>
              <option value="all">This month + arrears</option>
            </select>
            <input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="Shop number or name" />
            <button className="btn ghost" type="submit">View</button>
          </form>
        </div>

        <div className="card">
          {groups.length === 0 ? (
            <p className="muted">
              {show === "due" ? "Nothing due - everything is collected." : "No invoices match this filter."}
            </p>
          ) : (
            <div className="tablewrap"><table>
              <thead><tr><th>Shop</th><th>Month</th><th className="r">Amount</th><th className="r">Status</th></tr></thead>
              <tbody>
                {groups.map(([shopNo, list]) => {
                  const due = list.filter(r => r.status === "unpaid");
                  const totalDue = due.reduce((s, r) => s + Number(r.amount), 0);
                  return list.map((r, i) => (
                    <tr key={r.id}>
                      {i === 0 ? (
                        <td rowSpan={list.length}>
                          <strong>{shopNo}</strong> · {r.shops.name}
                          <div className="rowsub">
                            {r.shops.floors.name}
                            {r.shops.owner_name ? ` · ${r.shops.owner_name}` : ""}
                          </div>
                          {due.length > 1 && (
                            <div className="rowsub" style={{ color: "var(--danger)", fontWeight: 600 }}>
                              Total due {money(totalDue)} · {due.length} months
                            </div>
                          )}
                        </td>
                      ) : null}
                      <td>
                        {periodLabel(r.period)}
                        {r.period < period && r.status === "unpaid" && (
                          <> <span className="badge unpaid">overdue</span></>
                        )}
                      </td>
                      <td className="r num">{money(r.amount)}</td>
                      <td className="r">
                        {r.status === "paid" ? (
                          <>
                            <span className="badge paid">Paid</span>
                            <div className="rowsub">
                              {r.paid_at &&
                                new Date(r.paid_at).toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                              {" · "}{r.profiles?.name ?? "-"}
                            </div>
                            {user.role === "admin" && (
                              <form action={undoPaid} style={{ display: "inline" }}>
                                <input type="hidden" name="invoice_id" value={r.id} />
                                <button className="btn ghost small">Undo</button>
                              </form>
                            )}
                          </>
                        ) : (
                          <form action={markPaid} style={{ display: "inline" }}>
                            <input type="hidden" name="invoice_id" value={r.id} />
                            <button className="btn small">Mark collected</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table></div>
          )}
        </div>
        {user.role === "staff" && (
          <p className="muted" style={{ fontSize: 13 }}>
            You&apos;re on a collector account - record payments here, including old pending months. Totals and reports are visible to the administrator.
          </p>
        )}
    </AppShell>
  );
}
