import AppShell from "@/components/AppShell";
import ConfirmButton from "@/components/ConfirmButton";
import PendingButton from "@/components/PendingButton";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { money, currentPeriod, periodLabel } from "@/lib/util";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const CATEGORIES = [
  "Electrical Work", "Lift Maintenance", "Plumbing", "Cleaning", "Security",
  "Building Maintenance", "Material Purchases", "Shop-related Expenses", "Miscellaneous Expenses",
];

async function paySalary(formData: FormData) {
  "use server";
  const user = await requireAdmin();
  const supabase = await supabaseServer();
  const staffId = String(formData.get("staff_id") || "");
  const salaryPeriod = String(formData.get("salary_period") || "").trim();
  const amount = Number(formData.get("amount") || 0);
  const spentOn = String(formData.get("spent_on") || "").trim() || new Date().toISOString().slice(0, 10);
  const notes = String(formData.get("notes") || "").trim() || null;
  if (!staffId || !(amount > 0)) redirect("/expenses?tab=salary&err=Pick+a+staff+member+and+a+valid+amount");

  const { data: staff } = await supabase.from("profiles").select("name").eq("id", staffId).single();
  const label = /^\d{4}-\d{2}$/.test(salaryPeriod) ? periodLabel(salaryPeriod) : "salary";
  const { error } = await supabase.from("mallpay_expenses").insert({
    spent_on: spentOn,
    category: "Staff Salaries",
    description: `Salary — ${staff?.name ?? "staff"}${/^\d{4}-\d{2}$/.test(salaryPeriod) ? ` — ${label}` : ""}`,
    amount,
    notes,
    added_by: user.id,
    paid_to: staffId,
    salary_period: /^\d{4}-\d{2}$/.test(salaryPeriod) ? salaryPeriod : null,
  });
  if (error) redirect(`/expenses?tab=salary&err=${encodeURIComponent(error.message)}`);
  redirect("/expenses?ok=Salary+paid+and+recorded");
}

async function saveExpense(formData: FormData) {
  "use server";
  const user = await requireAdmin();
  const supabase = await supabaseServer();
  const id = Number(formData.get("id") || 0);
  const row = {
    spent_on: String(formData.get("spent_on") || "").trim() || new Date().toISOString().slice(0, 10),
    category: String(formData.get("category") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    amount: Number(formData.get("amount") || 0),
    notes: String(formData.get("notes") || "").trim() || null,
  };
  if (!row.category || !row.description || !(row.amount >= 0)) {
    redirect(`/expenses?${id ? `edit=${id}` : "tab=other"}&err=Category,+description,+and+a+valid+amount+are+required`);
  }
  if (id) {
    const { error } = await supabase.from("mallpay_expenses").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) redirect(`/expenses?edit=${id}&err=${encodeURIComponent(error.message)}`);
    redirect("/expenses?ok=Expense+updated");
  } else {
    const { error } = await supabase.from("mallpay_expenses").insert({ ...row, added_by: user.id });
    if (error) redirect(`/expenses?tab=other&err=${encodeURIComponent(error.message)}`);
    redirect("/expenses?ok=Expense+added");
  }
}

async function deleteExpense(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = await supabaseServer();
  const id = Number(formData.get("id"));
  if (id) await supabase.from("mallpay_expenses").delete().eq("id", id);
  redirect("/expenses?ok=Expense+deleted");
}

type Expense = {
  id: number; spent_on: string; category: string; description: string;
  amount: number; notes: string | null; salary_period: string | null;
  profiles_added: { name: string } | null; profiles_paid: { name: string } | null;
};

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string; category?: string; q?: string; edit?: string; ok?: string; err?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const supabase = await supabaseServer();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : "";
  const tab = sp.tab === "other" ? "other" : sp.tab === "salary" ? "salary" : "salary";

  let editing: Expense | null = null;
  if (sp.edit) {
    const { data } = await supabase.from("mallpay_expenses").select("*").eq("id", Number(sp.edit)).single();
    editing = data as Expense | null;
  }

  const [{ data }, { data: staff }] = await Promise.all([
    supabase
      .from("mallpay_expenses")
      .select("id,spent_on,category,description,amount,notes,salary_period,profiles_added:added_by(name),profiles_paid:paid_to(name)")
      .order("spent_on", { ascending: false })
      .order("id", { ascending: false }),
    supabase.from("profiles").select("id,name,staff_type").eq("role", "staff").eq("active", true).order("name"),
  ]);

  let rows = (data ?? []) as unknown as Expense[];
  const grandTotal = rows.reduce((s, r) => s + Number(r.amount), 0);
  const thisMonthTotal = rows.filter((r) => r.spent_on.slice(0, 7) === currentPeriod()).reduce((s, r) => s + Number(r.amount), 0);
  const salaryTotal = rows.filter((r) => r.category === "Staff Salaries").reduce((s, r) => s + Number(r.amount), 0);

  if (month) rows = rows.filter((r) => r.spent_on.slice(0, 7) === month);
  if (sp.category) rows = rows.filter((r) => r.category === sp.category);
  if (sp.q) {
    const n = sp.q.toLowerCase();
    rows = rows.filter((r) => r.description.toLowerCase().includes(n) || r.category.toLowerCase().includes(n) || (r.notes ?? "").toLowerCase().includes(n));
  }
  const filteredTotal = rows.reduce((s, r) => s + Number(r.amount), 0);
  const usedCategories = [...new Set([...CATEGORIES, ...(data ?? []).map((r) => r.category).filter((c) => c !== "Staff Salaries")])];
  const staffList = (staff ?? []) as { id: string; name: string; staff_type: string | null }[];
  const ev = (k: keyof Expense) => (editing?.[k] ?? "") as string | number;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell user={user} active="/expenses">
      <h1>Expenses</h1>
      {sp.ok && <div className="flash ok">{sp.ok}</div>}
      {sp.err && <div className="flash err">{sp.err}</div>}

      <div className="grid c4" style={{ marginTop: 14 }}>
        <div className="kpi featured"><div className="kpi-body"><div className="kpi-label">Total expenses (all time)</div><div className="kpi-value">{money(grandTotal)}</div></div></div>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">This month · {periodLabel(currentPeriod())}</div><div className="kpi-value">{money(thisMonthTotal)}</div></div></div>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">Salaries paid (all time)</div><div className="kpi-value">{money(salaryTotal)}</div></div></div>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">In current view</div><div className="kpi-value">{money(filteredTotal)}</div></div></div>
      </div>

      {editing ? (
        <div className="card" style={{ maxWidth: 620 }}>
          <h2>Edit expense</h2>
          <form action={saveExpense}>
            <input type="hidden" name="id" value={editing.id} />
            <div className="frow">
              <div className="field"><label>Date</label><input type="date" name="spent_on" defaultValue={String(ev("spent_on") || today)} /></div>
              <div className="field"><label>Category</label><input type="text" name="category" list="cats" defaultValue={String(ev("category"))} required /><datalist id="cats">{usedCategories.map((c) => <option key={c} value={c} />)}</datalist></div>
            </div>
            <div className="field"><label>Description</label><input type="text" name="description" defaultValue={String(ev("description"))} required /></div>
            <div className="frow">
              <div className="field"><label>Amount</label><input type="number" step="0.01" min="0" name="amount" defaultValue={String(editing.amount)} required /></div>
              <div className="field"><label>Notes <span className="muted">(optional)</span></label><input type="text" name="notes" defaultValue={String(ev("notes"))} /></div>
            </div>
            <PendingButton className="btn" pendingText="Saving…">Save changes</PendingButton>{" "}
            <a className="btn ghost" href="/expenses">Cancel</a>
          </form>
        </div>
      ) : (
        <>
          <div className="seg-tabs">
            <a className={"seg-tab" + (tab === "salary" ? " on" : "")} href="/expenses?tab=salary">💼 Pay staff salary</a>
            <a className={"seg-tab" + (tab === "other" ? " on" : "")} href="/expenses?tab=other">🧾 Other expense</a>
          </div>

          {tab === "salary" ? (
            <div className="card" style={{ maxWidth: 620 }}>
              <h2>Pay staff salary</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
                Records the payment as an expense and posts a salary slip to that staff member — they can see it when they log in.
              </p>
              {staffList.length === 0 ? (
                <p className="muted">No staff accounts yet. Create collection or department staff in <a href="/setup">Setup</a> first.</p>
              ) : (
                <form action={paySalary}>
                  <div className="frow">
                    <div className="field">
                      <label>Staff member</label>
                      <select name="staff_id" required defaultValue="">
                        <option value="" disabled>Select staff…</option>
                        {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}{s.staff_type ? ` · ${s.staff_type}` : ""}</option>)}
                      </select>
                    </div>
                    <div className="field"><label>Salary for month</label><input type="month" name="salary_period" defaultValue={currentPeriod()} /></div>
                  </div>
                  <div className="frow">
                    <div className="field"><label>Amount</label><input type="number" step="0.01" min="1" name="amount" placeholder="e.g. 45000" required /></div>
                    <div className="field"><label>Paid on</label><input type="date" name="spent_on" defaultValue={today} /></div>
                  </div>
                  <div className="field"><label>Notes <span className="muted">(optional)</span></label><input type="text" name="notes" placeholder="e.g. includes overtime" /></div>
                  <PendingButton className="btn" pendingText="Paying…">Pay salary</PendingButton>
                </form>
              )}
            </div>
          ) : (
            <div className="card" style={{ maxWidth: 620 }}>
              <h2>Add other expense</h2>
              <form action={saveExpense}>
                <div className="frow">
                  <div className="field"><label>Date</label><input type="date" name="spent_on" defaultValue={today} /></div>
                  <div className="field"><label>Category</label><input type="text" name="category" list="cats" placeholder="e.g. Electrical Work" required /><datalist id="cats">{usedCategories.map((c) => <option key={c} value={c} />)}</datalist></div>
                </div>
                <div className="field"><label>Description</label><input type="text" name="description" placeholder="e.g. Replaced 3rd-floor corridor lights" required /></div>
                <div className="frow">
                  <div className="field"><label>Amount</label><input type="number" step="0.01" min="0" name="amount" placeholder="0" required /></div>
                  <div className="field"><label>Notes <span className="muted">(optional)</span></label><input type="text" name="notes" /></div>
                </div>
                <PendingButton className="btn" pendingText="Saving…">Add expense</PendingButton>
              </form>
            </div>
          )}
        </>
      )}

      <div className="filters">
        <form method="get" className="filters" style={{ margin: 0 }} key={`${month}-${sp.category ?? ""}-${sp.q ?? ""}`}>
          <input type="month" name="month" defaultValue={month} />
          <select name="category" defaultValue={sp.category ?? ""}>
            <option value="">All categories</option>
            <option value="Staff Salaries">Staff Salaries</option>
            {usedCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="Search description…" />
          <button className="btn ghost" type="submit">Filter</button>
        </form>
        {(month || sp.category || sp.q) && <a className="btn ghost" href="/expenses">Clear</a>}
      </div>

      <div className="card">
        <h2>Expense records</h2>
        {rows.length === 0 ? (
          <p className="muted">No expenses match this view.</p>
        ) : (
          <div className="tablewrap"><table>
            <thead><tr><th>Description / paid to</th><th className="r">Amount</th><th>Actions</th><th>Category</th><th>Date</th><th>Added by</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.profiles_paid?.name ?? r.description}</strong>
                    {r.profiles_paid && <div className="rowsub">{r.description}{r.salary_period ? ` · ${periodLabel(r.salary_period)}` : ""}</div>}
                    {r.notes && <div className="rowsub">{r.notes}</div>}
                  </td>
                  <td className="r num"><strong>{money(r.amount)}</strong></td>
                  <td>
                    <span className="row-actions">
                      <a className="btn ghost small" href={`/expenses?edit=${r.id}`}>Edit</a>
                      <form action={deleteExpense} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <ConfirmButton className="btn ghost small" message={`Delete this ${r.category} record of ${money(r.amount)}?`}>Delete</ConfirmButton>
                      </form>
                    </span>
                  </td>
                  <td>
                    {r.category === "Staff Salaries" ? <span className="badge paid">Salary</span> : r.category}
                  </td>
                  <td className="num">{r.spent_on}</td>
                  <td>{r.profiles_added?.name ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </AppShell>
  );
}
