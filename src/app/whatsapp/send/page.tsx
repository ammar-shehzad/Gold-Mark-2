import AppShell from "@/components/AppShell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

async function sendTargetedMessage(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = await supabaseServer();

  const message = String(formData.get("message") || "").trim();
  const delayMinutes = Number(formData.get("delay_minutes") || 0);
  const floorIds = formData.getAll("floor_ids").map(Number).filter(Boolean);
  const shopIds = formData.getAll("shop_ids").map(Number).filter(Boolean);
  const unpaidOnly = formData.get("unpaid_only") === "on";
  if (!message) redirect("/whatsapp/send?err=Message+is+required");

  const { data: allShops } = await supabase.from("shops").select("id,floor_id").eq("active", true);
  let targetShopIds = new Set((allShops ?? []).map((s) => s.id));

  if (floorIds.length > 0) {
    const floorSet = new Set(floorIds);
    targetShopIds = new Set((allShops ?? []).filter((s) => floorSet.has(s.floor_id)).map((s) => s.id));
  }
  if (shopIds.length > 0) {
    const shopSet = new Set(shopIds);
    targetShopIds = new Set([...targetShopIds].filter((id) => shopSet.has(id)));
  }
  if (unpaidOnly) {
    const { data: unpaidInvoices } = await supabase.from("invoices").select("shop_id").eq("status", "unpaid");
    const unpaidShopIds = new Set((unpaidInvoices ?? []).map((i) => i.shop_id));
    targetShopIds = new Set([...targetShopIds].filter((id) => unpaidShopIds.has(id)));
  }
  if (targetShopIds.size === 0) redirect("/whatsapp/send?err=No+shops+match+these+filters");

  const { data: links } = await supabase.from("mallpay_shop_owners").select("owner_id").in("shop_id", [...targetShopIds]);
  const ownerIds = [...new Set((links ?? []).map((l) => l.owner_id))];
  if (ownerIds.length === 0) redirect("/whatsapp/send?err=No+owners+linked+to+the+matching+shops");

  const { data: owners } = await supabase
    .from("profiles")
    .select("whatsapp_number")
    .in("id", ownerIds)
    .eq("active", true)
    .eq("notify_whatsapp", true)
    .not("whatsapp_number", "is", null);

  const recipients = (owners ?? []).filter((o) => o.whatsapp_number);
  if (recipients.length === 0) redirect("/whatsapp/send?err=No+matching+owners+have+WhatsApp+notifications+enabled");

  // Every recipient shares the exact same scheduled_at, same pattern as
  // notices - the bot releases the whole batch together.
  const scheduledAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
  await supabase.from("mallpay_whatsapp_outbox").insert(
    recipients.map((o) => ({
      to_number: o.whatsapp_number as string,
      message,
      // Reuses the 'notice' kind - this is the same thing conceptually
      // (an admin-composed broadcast), just recipient-filtered instead of
      // going to every owner. Avoids widening the outbox kind constraint
      // again for what is functionally the same category of message.
      kind: "notice" as const,
      scheduled_at: scheduledAt,
    }))
  );

  redirect(`/whatsapp/send?ok=Message+queued+for+${recipients.length}+recipients`);
}

export default async function WhatsappSendPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const supabase = await supabaseServer();

  const [{ data: floors }, { data: shops }] = await Promise.all([
    supabase.from("floors").select("*").order("sort").order("name"),
    supabase.from("shops").select("id,shop_number,name,floor_id").eq("active", true).order("shop_number"),
  ]);

  return (
    <AppShell user={user} active="/whatsapp">
      <h1>Send targeted WhatsApp message</h1>
      <div className="filters">
        <Link className="btn ghost" href="/whatsapp">← Connection &amp; message log</Link>
        <Link className="btn ghost" href="/whatsapp/settings" style={{ marginLeft: "auto" }}>Settings</Link>
      </div>
      {sp.ok && <div className="flash ok">{sp.ok}</div>}
      {sp.err && <div className="flash err">{sp.err}</div>}

      <div className="card" style={{ maxWidth: 640 }}>
        <form action={sendTargetedMessage}>
          <div className="field">
            <label>Filter by floor <span className="muted">(optional - leave all unchecked for every floor)</span></label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {(floors ?? []).map((f) => (
                <label key={f.id} style={{ fontSize: 14 }}>
                  <input type="checkbox" name="floor_ids" value={f.id} style={{ width: "auto", marginRight: 4 }} />
                  {f.name}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Filter by shop <span className="muted">(optional - leave all unchecked for every shop)</span></label>
            <div className="tablewrap" style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", padding: 10 }}>
              {(shops ?? []).map((s) => (
                <label key={s.id} style={{ display: "block", fontSize: 14, marginBottom: 4 }}>
                  <input type="checkbox" name="shop_ids" value={s.id} style={{ width: "auto", marginRight: 6 }} />
                  {s.shop_number} · {s.name}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label>
              <input type="checkbox" name="unpaid_only" style={{ width: "auto" }} />{" "}
              Only shops with an unpaid invoice
            </label>
          </div>
          <div className="field">
            <label>Message</label>
            <textarea name="message" rows={4} required placeholder="Type the message to send..." />
          </div>
          <div className="field">
            <label>Delivery</label>
            <select name="delay_minutes" defaultValue="0">
              <option value="0">Send now</option>
              <option value="5">In 5 minutes</option>
              <option value="15">In 15 minutes</option>
              <option value="30">In 30 minutes</option>
              <option value="60">In 1 hour</option>
              <option value="180">In 3 hours</option>
            </select>
          </div>
          <button className="btn">Send</button>
        </form>
      </div>
    </AppShell>
  );
}
