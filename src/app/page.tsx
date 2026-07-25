import AppShell from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { WidgetCard } from "@/components/WidgetCard";
import { DonutChart } from "@/components/charts/DonutChart";
import { LineChart } from "@/components/charts/LineChart";
import { ShopIcon, MoneyIcon, ClockIcon, CheckIcon } from "@/components/icons";
import MonthDayFilter from "@/components/MonthDayFilter";
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

function lastPeriods(n: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function shortMonth(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; day?: string }>;
}) {
  const user = await requireUser();
  if (user.role === "staff") redirect(user.staff_type === "department" ? "/complaints" : "/collector");
  if (user.role === "owner") redirect("/owner");

  const sp = await searchParams;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : "";
  const period = day ? day.slice(0, 7) : (/^\d{4}-\d{2}$/.test(sp.period ?? "") ? sp.period! : currentPeriod());
  const supabase = await supabaseServer();

  if (period === currentPeriod()) {
    await supabase.rpc("ensure_invoices", { p_period: period });
  }

  const trendPeriods = lastPeriods(6);
  // day range (local) for "collected on this exact date"
  const dayStart = day ? new Date(day + "T00:00:00") : null;
  const dayEnd = day ? new Date(day + "T23:59:59.999") : null;

  const [{ data: invoices }, { count: shopCount }, { data: arrearsRaw }, { data: trendRaw }, { data: expRows }, { data: recentExp }, { data: dayColl }] = await Promise.all([
    supabase
      .from("invoices")
      .select("amount,status,paid_at,period,shops(shop_number,name,floors(name,sort)),profiles:collected_by(name)")
      .eq("period", period),
    supabase.from("shops").select("id", { count: "exact", head: true }).eq("active", true),
    supabase
      .from("invoices")
      .select("amount,period,shops(shop_number,name)")
      .eq("status", "unpaid")
      .lt("period", currentPeriod()),
    supabase.from("invoices").select("amount,period").in("period", trendPeriods),
    // expenses spent within the viewed month (for the net figure)
    supabase.from("mallpay_expenses").select("amount,spent_on").gte("spent_on", `${period}-01`).lte("spent_on", `${period}-31`),
    // latest expense records for the "Recent expenses" widget
    supabase.from("mallpay_expenses").select("spent_on,category,description,amount,profiles_added:added_by(name),profiles_paid:paid_to(name)").order("spent_on", { ascending: false }).order("id", { ascending: false }).limit(8),
    // collections made on the specific chosen day (any period)
    day
      ? supabase.from("invoices").select("amount,period,paid_at,shops(shop_number,name),profiles:collected_by(name)").eq("status", "paid").gte("paid_at", dayStart!.toISOString()).lte("paid_at", dayEnd!.toISOString()).order("paid_at", { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const expensesTotal = (expRows ?? []).reduce((s, e) => s + Number(e.amount), 0);
  type DayColl = { amount: number; period: string; paid_at: string | null; shops: { shop_number: string; name: string }; profiles: { name: string } | null };
  const dayCollections = (dayColl ?? []) as unknown as DayColl[];
  const dayTotal = dayCollections.reduce((s, r) => s + Number(r.amount), 0);

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
  const net = collected - expensesTotal;

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

  const trendMap = new Map<string, number>(trendPeriods.map(p => [p, 0]));
  for (const t of (trendRaw ?? []) as { amount: number; period: string }[]) {
    trendMap.set(t.period, (trendMap.get(t.period) ?? 0) + Number(t.amount));
  }
  const trendPoints = trendPeriods.map(p => ({ label: shortMonth(p), value: trendMap.get(p) ?? 0 }));

  return (
    <AppShell user={user} active="/">
      <div className="filters" style={{ alignItems: "flex-end" }}>
        <form method="get" className="filters" style={{ margin: 0, alignItems: "flex-end" }} key={`${period}-${day}`}>
          <MonthDayFilter period={period} day={day} />
          <button className="btn ghost" type="submit">View</button>
        </form>
        {day && <Link className="btn ghost" href="/">Clear day</Link>}
        <Link className="btn ghost" href="/shops?new=1" style={{ marginLeft: "auto" }}>
          + Register shop
        </Link>
      </div>

      {day && (
        <div className="card" style={{ borderColor: "var(--accent)" }}>
          <div className="widget-head">
            <h2>Collected on {new Date(day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h2>
            <span className="kpi-value" style={{ marginLeft: "auto", color: "var(--success)" }}>{money(dayTotal)}</span>
          </div>
          {dayCollections.length === 0 ? (
            <p className="muted">No collections were recorded on this date.</p>
          ) : (
            <div className="tablewrap fit"><table>
              <thead><tr><th>Shop</th><th>For month</th><th>Time</th><th>Collector</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {dayCollections.map((r, i) => (
                  <tr key={i}>
                    <td><strong>{r.shops.shop_number}</strong> · {r.shops.name}</td>
                    <td>{periodLabel(r.period)}</td>
                    <td className="num">{r.paid_at ? new Date(r.paid_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "-"}</td>
                    <td>{r.profiles?.name ?? "-"}</td>
                    <td className="r"><span className="badge paid num">{money(r.amount)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {(shopCount ?? 0) === 0 && (
        <div className="card">
          <h2>Welcome - let&apos;s set up your mall</h2>
          <p className="muted">
            Check your floors and fee tiers in <Link href="/setup">Setup</Link>, then{" "}
            <Link href="/shops?new=1">register your first shop</Link>. Monthly invoices are created automatically.
          </p>
        </div>
      )}

      <div className="grid c4">
        <KpiCard label={`Collected · ${periodLabel(period)}`} value={money(collected)} icon={<MoneyIcon />} tone="hero" />
        <KpiCard label={`Expenses · ${periodLabel(period)}`} value={money(expensesTotal)} icon={<ClockIcon />} tone="bad" />
        <KpiCard label="Net (collected − expenses)" value={money(net)} icon={<CheckIcon />} tone={net >= 0 ? "good" : "bad"} />
        <KpiCard label="Pending" value={money(pending)} icon={<ClockIcon />} tone="bad" />
      </div>
      <div className="grid c2" style={{ marginTop: -4 }}>
        <KpiCard label="Active shops" value={String(shopCount ?? 0)} icon={<ShopIcon />} />
        <KpiCard label="Shops paid" value={`${paidCount} / ${rows.length}`} icon={<CheckIcon />} />
      </div>

      <div className="grid c2">
        <WidgetCard title={`Collection overview · ${periodLabel(period)}`}>
          <div className="donut-row">
            <DonutChart
              centerValue={`${pct}%`}
              centerLabel="Collected"
              segments={[
                { label: "Collected", value: collected, color: "var(--success)" },
                { label: "Pending", value: pending, color: "var(--warning)" },
                { label: "Arrears (past months)", value: arrearsTotal, color: "var(--danger)" },
              ]}
            />
            <div className="donut-legend">
              <div className="donut-legend-item">
                <span className="donut-legend-dot" style={{ background: "var(--success)" }} />
                Collected <span className="num" style={{ marginLeft: "auto" }}>{money(collected)}</span>
              </div>
              <div className="donut-legend-item">
                <span className="donut-legend-dot" style={{ background: "var(--warning)" }} />
                Pending <span className="num" style={{ marginLeft: "auto" }}>{money(pending)}</span>
              </div>
              {arrearsTotal > 0 && (
                <div className="donut-legend-item">
                  <span className="donut-legend-dot" style={{ background: "var(--danger)" }} />
                  Arrears <span className="num" style={{ marginLeft: "auto" }}>{money(arrearsTotal)}</span>
                </div>
              )}
            </div>
          </div>
        </WidgetCard>
        <WidgetCard title="Monthly collection trend">
          <LineChart points={trendPoints} />
        </WidgetCard>
      </div>

      {defaulters.length > 0 && (
        <div className="card">
          <h2 style={{ color: "var(--danger)" }}>Arrears - old months pending · {money(arrearsTotal)}</h2>
          <div className="tablewrap fit"><table>
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
              and {defaulters.length - 8} more - see Collect page for the full list.
            </p>
          )}
        </div>
      )}

      <div className="grid c2">
        <WidgetCard title="By floor">
          {floors.length === 0 ? (
            <p className="muted">No invoices for this month yet.</p>
          ) : (
            <div className="tablewrap fit"><table>
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
        </WidgetCard>
        <WidgetCard title="Recent collections">
          {recent.length === 0 ? (
            <p className="muted">No payments recorded yet this month.</p>
          ) : (
            <div className="tablewrap fit"><table>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <strong>{r.shops.shop_number}</strong> · {r.shops.name}
                      <div className="rowsub">
                        by {r.profiles?.name ?? "-"} ·{" "}
                        {new Date(r.paid_at!).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                      </div>
                    </td>
                    <td className="r"><span className="badge paid num">{money(r.amount)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </WidgetCard>
      </div>

      <div className="grid c2">
        <WidgetCard title="Recent expenses & salaries">
          {(recentExp ?? []).length === 0 ? (
            <p className="muted">No expenses recorded yet.</p>
          ) : (
            <div className="tablewrap fit"><table>
              <tbody>
                {((recentExp ?? []) as unknown as { spent_on: string; category: string; description: string; amount: number; profiles_added: { name: string } | null; profiles_paid: { name: string } | null }[]).map((e, i) => (
                  <tr key={i}>
                    <td>
                      {e.category === "Staff Salaries" ? <span className="badge paid">Salary</span> : <strong>{e.category}</strong>}{" "}
                      {e.profiles_paid ? `to ${e.profiles_paid.name}` : e.description}
                      <div className="rowsub">
                        {new Date(e.spent_on + "T12:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                        {e.profiles_added ? ` · by ${e.profiles_added.name}` : ""}
                      </div>
                    </td>
                    <td className="r"><span className="badge unpaid num">− {money(e.amount)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </WidgetCard>
        <WidgetCard title={`Net for ${periodLabel(period)}`}>
          <div className="donut-legend" style={{ fontSize: 15 }}>
            <div className="donut-legend-item"><span className="donut-legend-dot" style={{ background: "var(--success)" }} />Collected<span className="num" style={{ marginLeft: "auto" }}>{money(collected)}</span></div>
            <div className="donut-legend-item"><span className="donut-legend-dot" style={{ background: "var(--danger)" }} />Expenses<span className="num" style={{ marginLeft: "auto" }}>− {money(expensesTotal)}</span></div>
            <div className="donut-legend-item" style={{ borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 4, fontWeight: 700 }}>
              Net income<span className="num" style={{ marginLeft: "auto", color: net >= 0 ? "var(--success)" : "var(--danger)" }}>{money(net)}</span>
            </div>
          </div>
        </WidgetCard>
      </div>
    </AppShell>
  );
}
