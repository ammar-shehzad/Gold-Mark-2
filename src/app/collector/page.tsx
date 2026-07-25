import AppShell from "@/components/AppShell";
import { requireStaff } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { money, periodLabel } from "@/lib/util";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Row = {
  amount: number; paid_at: string | null; period: string;
  shops: { shop_number: string; name: string };
};

// Restricted dashboard for collector staff: shows ONLY today's own work -
// no monthly/yearly totals, no overall income, no reports (those live on the
// admin dashboard, which collectors can't reach). Admins may view it too.
export default async function CollectorDashboard() {
  const user = await requireStaff();
  if (user.role === "staff" && user.staff_type === "department") redirect("/complaints");

  const supabase = await supabaseServer();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from("invoices")
    .select("amount,paid_at,period,shops(shop_number,name)")
    .eq("status", "paid")
    .eq("collected_by", user.id)
    .gte("paid_at", todayStart.toISOString())
    .order("paid_at", { ascending: false });

  const rows = (data ?? []) as unknown as Row[];
  const todayTotal = rows.reduce((s, r) => s + Number(r.amount), 0);
  const todayLabel = new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <AppShell user={user} active="/collector">
      <h1>Today&apos;s work</h1>
      <p className="muted" style={{ marginTop: -8 }}>{todayLabel}</p>

      <div className="grid c2" style={{ marginTop: 14 }}>
        <div className="kpi featured"><div className="kpi-body"><div className="kpi-label">Collected today by you</div><div className="kpi-value">{money(todayTotal)}</div></div></div>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">Shops collected today</div><div className="kpi-value">{rows.length}</div></div></div>
      </div>

      <div className="filters">
        <Link className="btn" href="/collect" style={{ marginLeft: "auto" }}>Go to Collect</Link>
      </div>

      <div className="card">
        <h2>Your collections today</h2>
        {rows.length === 0 ? (
          <p className="muted">You haven&apos;t recorded any collections yet today. Open Collect to get started.</p>
        ) : (
          <div className="tablewrap fit"><table>
            <thead><tr><th>Shop</th><th>Month</th><th>Time</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><strong>{r.shops.shop_number}</strong> · {r.shops.name}</td>
                  <td>{periodLabel(r.period)}</td>
                  <td className="num">{r.paid_at ? new Date(r.paid_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "-"}</td>
                  <td className="r"><span className="badge paid num">{money(r.amount)}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </AppShell>
  );
}
