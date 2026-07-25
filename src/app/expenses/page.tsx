import AppShell from "@/components/AppShell";
import ConfirmButton from "@/components/ConfirmButton";
import PendingButton from "@/components/PendingButton";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { money, currentPeriod, periodLabel } from "@/lib/util";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const CATEGORIES = [
  "Staff Salaries", "Electrical Work", "Lift Maintenance", "Plumbing", "Cleaning",
  "Security", "Building Maintenance", "Material Purchases", "Shop-related Expenses",
  "Miscellaneous Expenses",
];

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
    redirect(`/expenses?${id ? `edit=${id}` : ""}&err=Category,+description,+and+a+valid+amount+are+required`);
  }
  if (id) {
    const { error } = await supabase
      .from("mallpay_expenses")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) redirect(`/expenses?edit=${id}&err=${encodeURIComponent(error.message)}`);
    redirect("/expenses?ok=Expense+updated");
  } else {
    const { error } = await supabase.from("mallpay_expenses").insert({ ...row, added_by: user.id });
    if (error) redirect(`/expenses?err=${encodeURIComponent(error.message)}`);
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
  amount: number; notes: string | null; profiles: { name: string } | null;
};

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; category?: string; q?: string; edit?: string; ok?: string; err?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const supabase = await supabaseServer();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : "";

  let editing: Expense | null = null;
  if (sp.edit) {
    const { data } = await supabase.from("mallpay_expenses").select("*").eq("id", Number(sp.edit)).single();
    editing = data as Expense | null;
  }

  const { data } = await supabase
    .from("mallpay_expenses")
    .select("id,spent_on,category,description,amount,notes,profiles:added_by(name)")
    .order("spent_on", { ascending: false })
    .order("id", { ascending: false });

  let rows = (data ?? []) as unknown as Expense[];
  const grandTotal = rows.reduce((s, r) => s + Number(r.amount), 0);
  const thisMonthTotal = rows
    .filter((r) => r.spent_on.slice(0, 7) === currentPeriod())
    .reduce((s, r) => s + Number(r.amount), 0);

  if (month) rows = rows.filter((r) => r.spent_on.slice(0, 7) === month);
  if (sp.category) rows = rows.filter((r) => r.category === sp.category);
  if (sp.q) {
    const n = sp.q.toLowerCase();
    rows = rows.filter(
      (r) => r.description.toLowerCase().includes(n) || r.category.toLowerCase().includes(n) || (r.notes ?? "").toLowerCase().includes(n)
    );
  }
  const filteredTotal = rows.reduce((s, r) => s + Number(r.amount), 0);
  const usedCategories = [...new Set([...CATEGORIES, ...(data ?? []).map((r) => r.category)])];
  const ev = (k: keyof Expense) => (editing?.[k] ?? "") as string | number;

  return (
    <AppShell user={user} active="/expenses">
      <h1>Expenses</h1>
      {sp.ok && <div className="flash ok">{sp.ok}</div>}
      {sp.err && <div className="flash err">{sp.err}</div>}

      <div className="grid c4" style={{ marginTop: 14 }}>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">Total expenses (all time)</div><div className="kpi-value">{money(grandTotal)}</div></div></div>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">This month · {periodLabel(currentPeriod())}</div><div className="kpi-value">{money(thisMonthTotal)}</div></div></div>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">In current view</div><div className="kpi-value">{money(filteredTotal)}</div></div></div>
        <div className="kpi"><div className="kpi-body"><div className="kpi-label">Records in view</div><div className="kpi-value">{rows.length}</div></div></div>
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        <h2>{editing ? "Edit expense" : "Add expense"}</h2>
        <form action={saveExpense}>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="frow">
            <div className="field"><label>Date</label><input type="date" name="spent_on" defaultValue={String(ev("spent_on") || new Date().toISOString().slice(0, 10))} /></div>
            <div className="field">
              <label>Category</label>
              <input type="text" name="category" list="cats" defaultValue={String(ev("category"))} placeholder="e.g. Electrical Work" required />
              <datalist id="cats">{usedCategories.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
          </div>
          <div className="field"><label>Description</label><input type="text" name="description" defaultValue={String(ev("description"))} placeholder="e.g. Replaced 3rd-floor corridor lights" required /></div>
          <div className="frow">
            <div className="field"><label>Amount</label><input type="number" step="0.01" min="0" name="amount" defaultValue={editing ? String(editing.amount) : ""} placeholder="0" required /></div>
            <div className="field"><label>Notes <span className="muted">(optional)</span></label><input type="text" name="notes" defaultValue={String(ev("notes"))} /></div>
          </div>
          <PendingButton className="btn" pendingText="Saving…">{editing ? "Save changes" : "Add expense"}</PendingButton>
          {editing && <> {" "}<a className="btn ghost" href="/expenses">Cancel</a></>}
        </form>
      </div>

      <div className="filters">
        <form method="get" className="filters" style={{ margin: 0 }} key={`${month}-${sp.category ?? ""}-${sp.q ?? ""}`}>
          <input type="month" name="month" defaultValue={month} />
          <select name="category" defaultValue={sp.category ?? ""}>
            <option value="">All categories</option>
            {usedCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="Search description…" />
          <button className="btn ghost" type="submit">Filter</button>
        </form>
        {(month || sp.category || sp.q) && <a className="btn ghost" href="/expenses">Clear</a>}
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">No expenses match this view.</p>
        ) : (
          <div className="tablewrap"><table>
            <thead><tr><th>Date</th><th>Actions</th><th>Category</th><th>Description</th><th className="r">Amount</th><th>Added by</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.spent_on}</td>
                  <td>
                    <span className="row-actions">
                      <a className="btn ghost small" href={`/expenses?edit=${r.id}`}>Edit</a>
                      <form action={deleteExpense} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <ConfirmButton className="btn ghost small" message={`Delete this ${r.category} expense of ${money(r.amount)}?`}>Delete</ConfirmButton>
                      </form>
                    </span>
                  </td>
                  <td>{r.category}</td>
                  <td>{r.description}{r.notes && <div className="rowsub">{r.notes}</div>}</td>
                  <td className="r num">{money(r.amount)}</td>
                  <td>{r.profiles?.name ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </AppShell>
  );
}
