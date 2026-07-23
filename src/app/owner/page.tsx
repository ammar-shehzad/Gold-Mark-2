import AppShell from "@/components/AppShell";
import { requireOwner } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { money, periodLabel } from "@/lib/util";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

async function submitPayment(formData: FormData) {
  "use server";
  const user = await requireOwner();
  const supabase = await supabaseServer();
  const invoiceId = Number(formData.get("invoice_id"));
  const amount = Number(formData.get("amount"));
  const paidOn = String(formData.get("paid_on") || "");
  const transactionId = String(formData.get("transaction_id") || "").trim() || null;
  const file = formData.get("screenshot") as File | null;

  if (!invoiceId || !amount || amount <= 0 || !paidOn || !file || file.size === 0) {
    redirect(`/owner?invoice=${invoiceId}&err=missing`);
  }

  const path = `${user.id}/${Date.now()}-${file!.name}`;
  const { error: upErr } = await supabase.storage.from("payment-screenshots").upload(path, file!);
  if (upErr) redirect(`/owner?invoice=${invoiceId}&err=upload`);

  const { error } = await supabase.from("mallpay_payment_submissions").insert({
    invoice_id: invoiceId,
    owner_id: user.id,
    screenshot_url: path,
    transaction_id: transactionId,
    amount,
    paid_on: paidOn,
  });
  if (error) redirect(`/owner?invoice=${invoiceId}&err=save`);
  redirect("/owner?ok=1");
}

type Row = {
  id: number; amount: number; status: string; period: string;
  shops: { shop_number: string; name: string; floors: { name: string } };
};

export default async function OwnerPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string; invoice?: string }>;
}) {
  const user = await requireOwner();
  const sp = await searchParams;
  const supabase = await supabaseServer();

  const [{ data: invoicesRaw }, { data: settings }, { data: pendingRaw }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id,amount,status,period,shops(shop_number,name,floors(name))")
      .order("period", { ascending: false }),
    supabase.from("mall_settings").select("*").single(),
    supabase.from("mallpay_payment_submissions").select("invoice_id").eq("owner_id", user.id).eq("status", "pending"),
  ]);

  const rows = (invoicesRaw ?? []) as unknown as Row[];
  const pendingInvoiceIds = new Set((pendingRaw ?? []).map((p) => p.invoice_id));
  const payingInvoice = sp.invoice ? rows.find((r) => r.id === Number(sp.invoice)) : null;
  const hasBankDetails = settings?.bank_account_number;

  return (
    <AppShell user={user} active="/owner">
      <h1>My invoices</h1>
      {sp.err === "missing" && <div className="flash err">Amount, payment date, and a screenshot are required.</div>}
      {sp.err === "upload" && <div className="flash err">Could not upload the screenshot - try again.</div>}
      {sp.err === "save" && <div className="flash err">Could not save the payment details - try again.</div>}
      {sp.ok === "1" && <div className="flash ok">Payment submitted - the admin will review it shortly.</div>}

      {payingInvoice && (
        <div className="card" style={{ maxWidth: 480, marginTop: 14 }}>
          <h2>Pay {payingInvoice.shops.shop_number} · {periodLabel(payingInvoice.period)}</h2>
          {hasBankDetails ? (
            <div className="card" style={{ background: "var(--surface-2)", boxShadow: "none" }}>
              <p className="muted" style={{ margin: "0 0 6px" }}>Transfer to:</p>
              <p style={{ margin: "0 0 2px" }}><strong>{settings?.bank_name}</strong></p>
              <p style={{ margin: "0 0 2px" }}>{settings?.bank_account_title}</p>
              <p className="num" style={{ margin: 0, fontWeight: 650 }}>{settings?.bank_account_number}</p>
            </div>
          ) : (
            <p className="muted">Bank details haven&apos;t been set up yet - contact the admin.</p>
          )}
          <form action={submitPayment} style={{ marginTop: 14 }}>
            <input type="hidden" name="invoice_id" value={payingInvoice.id} />
            <div className="frow">
              <div className="field">
                <label>Amount paid</label>
                <input type="number" step="0.01" min="1" name="amount" defaultValue={payingInvoice.amount} required />
              </div>
              <div className="field">
                <label>Payment date</label>
                <input type="date" name="paid_on" required />
              </div>
            </div>
            <div className="field">
              <label>Transaction ID <span className="muted">(optional)</span></label>
              <input type="text" name="transaction_id" />
            </div>
            <div className="field">
              <label>Payment screenshot</label>
              <input type="file" name="screenshot" accept="image/*" required />
            </div>
            <button className="btn">Submit for verification</button>{" "}
            <Link className="btn ghost" href="/owner">Cancel</Link>
          </form>
        </div>
      )}

      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">No invoices yet.</p>
        ) : (
          <div className="tablewrap"><table>
            <thead><tr><th>Shop</th><th>Month</th><th className="r">Amount</th><th className="r">Status</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.shops.shop_number}</strong> · {r.shops.name}
                    <div className="rowsub">{r.shops.floors.name}</div>
                  </td>
                  <td>{periodLabel(r.period)}</td>
                  <td className="r num">{money(r.amount)}</td>
                  <td className="r">
                    {r.status === "paid" ? (
                      <span className="badge paid">Paid</span>
                    ) : pendingInvoiceIds.has(r.id) ? (
                      <span className="badge pending">Pending review</span>
                    ) : (
                      <span className="badge unpaid">Unpaid</span>
                    )}
                  </td>
                  <td className="r">
                    {r.status === "unpaid" && !pendingInvoiceIds.has(r.id) && (
                      <Link className="btn small" href={`/owner?invoice=${r.id}`}>Pay now</Link>
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
