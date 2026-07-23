import AppShell from "@/components/AppShell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { money, periodLabel } from "@/lib/util";
import { cancelPendingReminders } from "@/lib/reminders";
import { renderTemplate } from "@/lib/template";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function approvePayment(formData: FormData) {
  "use server";
  const user = await requireAdmin();
  const supabase = await supabaseServer();
  const id = Number(formData.get("id"));

  const { data: sub } = await supabase
    .from("mallpay_payment_submissions")
    .select("invoice_id,amount,invoices(period,shops(shop_number)),profiles:owner_id(whatsapp_number,notify_whatsapp)")
    .eq("id", id)
    .single();
  if (!sub) redirect("/payments?err=1");

  await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString(), collected_by: user.id })
    .eq("id", sub.invoice_id)
    .eq("status", "unpaid");
  await cancelPendingReminders(sub.invoice_id);

  await supabase
    .from("mallpay_payment_submissions")
    .update({ status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", id);

  const owner = sub.profiles as unknown as { whatsapp_number: string | null; notify_whatsapp: boolean } | null;
  const inv = sub.invoices as unknown as { period: string; shops: { shop_number: string } };
  if (owner?.whatsapp_number && owner.notify_whatsapp) {
    const { data: tmpl } = await supabase.from("mallpay_whatsapp_templates").select("body").eq("key", "payment_approved").single();
    const message = renderTemplate(
      tmpl?.body ?? "Your payment has been received and verified successfully. Shop {{shop_number}}, {{period_label}}, {{amount}}. Thank you.",
      { shop_number: inv.shops.shop_number, period_label: periodLabel(inv.period), amount: money(sub.amount) }
    );
    await supabase.from("mallpay_whatsapp_outbox").insert({
      to_number: owner.whatsapp_number,
      message,
      kind: "payment_approved",
      related_table: "mallpay_payment_submissions",
      related_id: id,
    });
  }
  redirect("/payments?ok=1");
}

async function rejectPayment(formData: FormData) {
  "use server";
  const user = await requireAdmin();
  const supabase = await supabaseServer();
  const id = Number(formData.get("id"));
  const note = String(formData.get("admin_note") || "").trim() || null;

  const { data: sub } = await supabase
    .from("mallpay_payment_submissions")
    .select("profiles:owner_id(whatsapp_number,notify_whatsapp)")
    .eq("id", id)
    .single();

  await supabase
    .from("mallpay_payment_submissions")
    .update({ status: "rejected", admin_note: note, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", id);

  const owner = sub?.profiles as unknown as { whatsapp_number: string | null; notify_whatsapp: boolean } | null;
  if (owner?.whatsapp_number && owner.notify_whatsapp) {
    const { data: tmpl } = await supabase.from("mallpay_whatsapp_templates").select("body").eq("key", "payment_rejected").single();
    const message = renderTemplate(
      tmpl?.body ?? "We could not verify your submitted payment. Please contact the management office or upload a valid payment proof.{{reason_suffix}}",
      { reason_suffix: note ? ` Reason: ${note}` : "" }
    );
    await supabase.from("mallpay_whatsapp_outbox").insert({
      to_number: owner.whatsapp_number,
      message,
      kind: "payment_rejected",
      related_table: "mallpay_payment_submissions",
      related_id: id,
    });
  }
  redirect("/payments?ok=1");
}

type Sub = {
  id: number; amount: number; transaction_id: string | null; paid_on: string; status: string; screenshot_url: string;
  invoices: { period: string; shops: { shop_number: string; name: string } };
  profiles: { name: string } | null;
};

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; ok?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const supabase = await supabaseServer();
  const status = ["pending", "approved", "rejected"].includes(sp.status ?? "") ? sp.status! : "pending";

  const { data } = await supabase
    .from("mallpay_payment_submissions")
    .select("id,amount,transaction_id,paid_on,status,screenshot_url,invoices(period,shops(shop_number,name)),profiles:owner_id(name)")
    .eq("status", status)
    .order("created_at", { ascending: false });

  const subs = (data ?? []) as unknown as Sub[];
  const withUrls = await Promise.all(
    subs.map(async (s) => {
      const { data: signed } = await supabase.storage.from("payment-screenshots").createSignedUrl(s.screenshot_url, 3600);
      return { ...s, signedUrl: signed?.signedUrl ?? null };
    })
  );

  return (
    <AppShell user={user} active="/payments">
      <h1>Payment verification</h1>
      {sp.ok && <div className="flash ok">Updated.</div>}

      <div className="filters">
        <form method="get" className="filters" style={{ margin: 0 }} key={status}>
          <select name="status" defaultValue={status}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button className="btn ghost" type="submit">View</button>
        </form>
      </div>

      <div className="card">
        {withUrls.length === 0 ? (
          <p className="muted">Nothing here.</p>
        ) : (
          <div className="tablewrap"><table>
            <thead>
              <tr><th>Shop</th><th>Owner</th><th>Amount</th><th>Txn ID</th><th>Paid on</th><th>Screenshot</th>{status === "pending" && <th className="r">Actions</th>}</tr>
            </thead>
            <tbody>
              {withUrls.map((s) => (
                <tr key={s.id}>
                  <td>{s.invoices.shops.shop_number} · {s.invoices.shops.name}<div className="rowsub">{periodLabel(s.invoices.period)}</div></td>
                  <td>{s.profiles?.name ?? "-"}</td>
                  <td className="num">{money(s.amount)}</td>
                  <td>{s.transaction_id ?? "-"}</td>
                  <td>{s.paid_on}</td>
                  <td>
                    {s.signedUrl ? (
                      <a className="btn ghost small" href={s.signedUrl} target="_blank" rel="noreferrer">View</a>
                    ) : "-"}
                  </td>
                  {status === "pending" && (
                    <td className="r">
                      <form action={approvePayment} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="btn small">Payment received</button>
                      </form>{" "}
                      <form action={rejectPayment} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="btn ghost small">Not received</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </AppShell>
  );
}
