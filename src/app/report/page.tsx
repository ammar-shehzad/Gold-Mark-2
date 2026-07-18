import AppShell from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { money, currentPeriod, periodLabel } from "@/lib/util";
import { ShopIcon, CheckIcon, MoneyIcon, ClockIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

type Row = {
  id: number; amount: number; status: string; paid_at: string | null; note: string | null;
  shops: { shop_number: string; name: string; owner_name: string | null; owner_phone: string | null; floor_id: number; floors: { name: string } };
  profiles: { name: string } | null;
};

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; floor?: string; show?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "") ? sp.period! : currentPeriod();
  const show = ["all", "paid", "unpaid"].includes(sp.show ?? "") ? sp.show! : "all";
  const floorId = sp.floor ? Number(sp.floor) : 0;
  const supabase = await supabaseServer();

  if (period === currentPeriod()) await supabase.rpc("ensure_invoices", { p_period: period });

  const [{ data: rowsRaw }, { data: floors }, { data: periods }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id,amount,status,paid_at,note,shops(shop_number,name,owner_name,owner_phone,floor_id,floors(name)),profiles:collected_by(name)")
      .eq("period", period)
      .order("shop_id"),
    supabase.from("floors").select("*").order("sort").order("name"),
    supabase.from("invoices").select("period").order("period", { ascending: false }),
  ]);

  // filtering happens here, in plain code — reliable regardless of query quirks
  let rows = (rowsRaw ?? []) as unknown as Row[];
  if (floorId) rows = rows.filter(r => r.shops.floor_id === floorId);
  if (show !== "all") rows = rows.filter(r => r.status === show);
  rows.sort((a, b) => a.shops.shop_number.localeCompare(b.shops.shop_number));

  const collected = rows.filter(r => r.status === "paid").reduce((s, r) => s + Number(r.amount), 0);
  const pending = rows.filter(r => r.status === "unpaid").reduce((s, r) => s + Number(r.amount), 0);
  const paidCount = rows.filter(r => r.status === "paid").length;
  const uniqPeriods = [...new Set([currentPeriod(), ...(periods ?? []).map(p => p.period)])].sort().reverse();

  const csvQuery = new URLSearchParams({
    period,
    ...(floorId ? { floor: String(floorId) } : {}),
    ...(show !== "all" ? { show } : {}),
  });

  return (
    <AppShell user={user} active="/report">
        <h1>Monthly report</h1>
        <div className="filters" style={{ marginTop: 14 }}>
          <form method="get" className="filters" style={{ margin: 0 }} key={`${period}-${floorId}-${show}`}>
            <select name="period" defaultValue={period}>
              {uniqPeriods.map(p => (
                <option key={p} value={p}>{periodLabel(p)}</option>
              ))}
            </select>
            <select name="floor" defaultValue={floorId ? String(floorId) : ""}>
              <option value="">All floors</option>
              {(floors ?? []).map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <select name="show" defaultValue={show}>
              <option value="all">Paid and unpaid</option>
              <option value="paid">Paid only</option>
              <option value="unpaid">Unpaid only</option>
            </select>
            <button className="btn ghost" type="submit">View</button>
          </form>
          <a className="btn ghost" style={{ marginLeft: "auto" }} href={`/report/csv?${csvQuery}`}>
            Download CSV
          </a>
          <a className="btn ghost" href={`/report/pdf?${csvQuery}`}>
            Download PDF
          </a>
        </div>

        <div className="grid c4">
          <KpiCard label="Shops in view" value={String(rows.length)} icon={<ShopIcon />} />
          <KpiCard label="Paid" value={String(paidCount)} icon={<CheckIcon />} />
          <KpiCard label="Collected" value={money(collected)} icon={<MoneyIcon />} tone="good" />
          <KpiCard label="Outstanding" value={money(pending)} icon={<ClockIcon />} tone="bad" />
        </div>

        <div className="card">
          {rows.length === 0 ? (
            <p className="muted">No invoices for this selection.</p>
          ) : (
            <div className="tablewrap"><table>
              <thead>
                <tr><th>Shop</th><th>Floor</th><th className="r">Amount</th><th className="r">Status</th><th>Collected</th></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.shops.shop_number}</strong> · {r.shops.name}
                      {r.shops.owner_name && (
                        <div className="rowsub">
                          {r.shops.owner_name}
                          {r.shops.owner_phone ? ` · ${r.shops.owner_phone}` : ""}
                        </div>
                      )}
                    </td>
                    <td>{r.shops.floors.name}</td>
                    <td className="r num">{money(r.amount)}</td>
                    <td className="r">
                      <span className={`badge ${r.status}`}>{r.status === "paid" ? "Paid" : "Unpaid"}</span>
                    </td>
                    <td>
                      {r.status === "paid" && r.paid_at ? (
                        <>
                          {new Date(r.paid_at).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                          <div className="rowsub">by {r.profiles?.name ?? "—"}</div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
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
