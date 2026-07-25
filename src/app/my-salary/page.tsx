import AppShell from "@/components/AppShell";
import { requireStaff } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { money, periodLabel, currentPeriod } from "@/lib/util";

export const dynamic = "force-dynamic";

type Slip = { id: number; spent_on: string; amount: number; salary_period: string | null; notes: string | null };

// Staff-facing salary history. RLS (expenses_staff_own_salary) restricts the
// query to rows where paid_to = the signed-in staff member, so a collector or
// department staffer sees only their own salary slips - never anyone else's,
// and never other expenses.
export default async function MySalaryPage() {
  const user = await requireStaff();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("mallpay_expenses")
    .select("id,spent_on,amount,salary_period,notes")
    .eq("paid_to", user.id)
    .order("spent_on", { ascending: false });

  const slips = (data ?? []) as unknown as Slip[];
  const total = slips.reduce((s, r) => s + Number(r.amount), 0);
  const thisMonth = slips.filter((r) => (r.salary_period ?? r.spent_on.slice(0, 7)) === currentPeriod()).reduce((s, r) => s + Number(r.amount), 0);

  return (
    <AppShell user={user} active="/my-salary">
      <h1>My salary</h1>
      <p className="muted" style={{ marginTop: -8 }}>Salary payments the administrator has recorded for you.</p>

      <div className="grid c2" style={{ marginTop: 14 }}>
        <div className="kpi featured"><div className="kpi-body"><div className="kpi-label">Received this month · {periodLabel(currentPeriod())}</div><div className="kpi-value">{money(thisMonth)}</div></div></div>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">Received all time</div><div className="kpi-value">{money(total)}</div></div></div>
      </div>

      <div className="card">
        <h2>Salary slips</h2>
        {slips.length === 0 ? (
          <p className="muted">No salary payments recorded yet.</p>
        ) : (
          <div className="tablewrap fit"><table>
            <thead><tr><th>For month</th><th>Paid on</th><th className="r">Amount</th><th>Notes</th></tr></thead>
            <tbody>
              {slips.map((s) => (
                <tr key={s.id}>
                  <td>{s.salary_period ? periodLabel(s.salary_period) : <span className="muted">-</span>}</td>
                  <td className="num">{new Date(s.spent_on + "T12:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className="r"><span className="badge paid num">{money(s.amount)}</span></td>
                  <td>{s.notes ?? <span className="muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </AppShell>
  );
}
