import AppHeader from "@/components/AppHeader";
import { requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { money, currentPeriod, periodLabel } from "@/lib/util";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Inv = {
  amount: number; status: string; paid_at: string | null; period: string;
  shops: { shop_number: string; name: string; floors: { name: string; sort: number } };
  profiles: { name: string } | null;
};

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  if (user.role === "staff") redirect("/collect");

  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "") ? sp.period! : currentPeriod();
  const supabase = await supabaseServer();

  if (period === currentPeriod()) {
    await supabase.rpc("ensure_invoices", { p_period: period });
  }

  const [{ data: invoices }, { count: shopCount }, { data: periods }, { data: arrearsRaw }] = await Promise.all([
    supabase
      .from("invoices")
      .select("amount,status,paid_at,period,shops(shop_number,name,floors(name,sort)),profiles:collected_by(name)")
      .eq("period", period),
    supabase.from("shops").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("invoices").select("period").order("period", { ascending: false }),
    supabase
      .from("invoices")
      .select("amount,period,shops(shop_number,name)")
      .eq("status", "unpaid")
      .lt("period", currentPeriod()),
  ]);

  type Arr = { amount: number; period: string; shops: { shop_number: string; name: string } };
  const arrearsByShop = new Map<string, { name: string; total: number; months: number }>();
  for (const a of (arrearsRaw ?? []) as unknown as Arr[]) {
    const e = arrearsByShop.get(a.shops.shop_number) ?? { name: a.shops.name, total: 0, months: 0 };
    e.total += Number(a.amount);
    e.months += 1;
    arrearsByShop.set(a.shops.shop_number, e);
  }
  const defaulters = [...arrearsByShop.entries()].sort((a, b) => b[1].total - a[1].total);
  const arrearsTotal = defaulters.reduce((s, [, d]) => s + d.total, 0);

  const rows = (invoices ?? []) as unknown as Inv[];
  const collected = rows.filter(r => r.status === "paid").reduce((s, r) => s + Number(r.amount), 0);
  const pending = rows.filter(r => r.status === "unpaid").reduce((s, r) => s + Number(r.amount), 0);
  const paidCount = rows.filter(r => r.status === "paid").length;
  const grand = collected + pending;
  const pct = grand > 0 ? Math.round((collected / grand) * 100) : 0;

  const byFloor = new Map<string, { total: number; paid: number; due: number; sort: number }>();
  for (const r of rows) {
    const f = r.shops.floors;
    const e = byFloor.get(f.name) ?? { total: 0, paid: 0, due: 0, sort: f.sort };
    e.total++;
    if (r.status === "paid") e.paid++;
    else e.due += Number(r.amount);
    byFloor.set(f.name, e);
  }
  const floors = [...byFloor.entries()].sort((a, b) => a[1].sort - b[1].sort);

  const recent = rows
    .filter(r => r.status === "paid" && r.paid_at)
    .sort((a, b) => (b.paid_at! > a.paid_at! ? 1 : -1))
    .slice(0, 8);

  const uniqPeriods = [...new Set([currentPeriod(), ...(periods ?? []).map(p => p.period)])].sort().reverse();

  return (
    <>
      <AppHeader user={user} active="/" />
      <main className="wrap">
        <h1>Dashboard</h1>
        <div className="filters">
          <form method="get" className="filters" style={{ margin: 0 }} key={period}>
            <select name="period" defaultValue={period}>
              {uniqPeriods.map(p => (
                <option key={p} value={p}>{periodLabel(p)}</option>
              ))}
            </select>
            <button className="btn ghost" type="submit">View</button>
          </form>
          <Link className="btn ghost" href="/shops?new=1" style={{ marginLeft: "auto" }}>
            + Register shop
          </Link>
        </div>

        {(shopCount ?? 0) === 0 && (
          <div className="card">
            <h2>Welcome — let&apos;s set up your mall</h2>
            <p className="muted">
              Check your floors and fee tiers in <Link href="/setup">Setup</Link>, then{" "}
              <Link href="/shops?new=1">register your first shop</Link>. Monthly invoices are created automatically.
            </p>
          </div>
        )}

        <div className="grid c4">
          <div className="stat"><div className="l">Active shops</div><div className="v num">{shopCount ?? 0}</div></div>
          <div className="stat"><div className="l">Collected · {periodLabel(period)}</div><div className="v num good">{money(collected)}</div></div>
          <div className="stat"><div className="l">Pending</div><div className="v num bad">{money(pending)}</div></div>
          <div className="stat"><div className="l">Shops paid</div><div className="v num">{paidCount} / {rows.length}</div></div>
        </div>

        <div className="card">
          <h2>Collection progress — {periodLabel(period)}</h2>
          <div className="meter"><i style={{ width: `${pct}%` }} /></div>
          <div className="meter-cap">
            <span>{pct}% collected</span>
            <span className="num">{money(collected)} of {money(grand)}</span>
          </div>
        </div>

        {defaulters.length > 0 && (
          <div className="card">
            <h2 style={{ color: "var(--danger)" }}>Arrears — old months pending · {money(arrearsTotal)}</h2>
            <div className="tablewrap"><table>
              <thead><tr><th>Shop</th><th className="r">Months</th><th className="r">Total due</th></tr></thead>
              <tbody>
                {defaulters.slice(0, 8).map(([no, d]) => (
                  <tr key={no}>
                    <td><strong>{no}</strong> · {d.name}</td>
                    <td className="r num">{d.months}</td>
                    <td className="r num" style={{ color: "var(--danger)", fontWeight: 600 }}>{money(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {defaulters.length > 8 && (
              <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
                and {defaulters.length - 8} more — see Collect page for the full list.
              </p>
            )}
          </div>
        )}

        <div className="grid c2">
          <div className="card" style={{ margin: 0 }}>
            <h2>By floor</h2>
            {floors.length === 0 ? (
              <p className="muted">No invoices for this month yet.</p>
            ) : (
              <div className="tablewrap"><table>
                <thead><tr><th>Floor</th><th className="r">Paid</th><th className="r">Amount due</th></tr></thead>
                <tbody>
                  {floors.map(([name, f]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="r num">{f.paid} / {f.total}</td>
                      <td className="r num">{money(f.due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
          <div className="card" style={{ margin: 0 }}>
            <h2>Recent collections</h2>
            {recent.length === 0 ? (
              <p className="muted">No payments recorded yet this month.</p>
            ) : (
              <div className="tablewrap"><table>
                <tbody>
                  {recent.map((r, i) => (
                    <tr key={i}>
                      <td>
                        {r.shops.shop_number} · {r.shops.name}
                        <div className="rowsub">
                          by {r.profiles?.name ?? "—"} ·{" "}
                          {new Date(r.paid_at!).toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                        </div>
                      </td>
                      <td className="r"><span className="badge paid num">{money(r.amount)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      </main>
      <footer className="wrap foot muted">MallPay maintenance collection</footer>
    </>
  );
}
