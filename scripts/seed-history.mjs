// Feature 9 — pre-fill historical collections for testing.
// Marks every active shop as COLLECTED for the last 6 full months (not the
// current month). Every seeded invoice carries note='SEED' so it can be
// removed later in one command (see unseed-history.mjs). Idempotent.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function lastMonths(n) {
  const now = new Date();
  const out = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out; // e.g. ['2026-06','2026-05',...] most recent first
}

// pick an admin to attribute the seeded collections to
const { data: admin } = await db.from("profiles").select("id").eq("role", "admin").eq("active", true).limit(1).maybeSingle();
const collectedBy = admin?.id ?? null;

const { data: shops } = await db.from("shops").select("id,custom_fee").eq("active", true);
const periods = lastMonths(6);
console.log(`Seeding ${shops.length} shops × ${periods.length} months = ${shops.length * periods.length} invoices…`);

let created = 0, marked = 0;
for (const period of periods) {
  // existing invoices for this period
  const { data: existing } = await db.from("invoices").select("id,shop_id,status").eq("period", period);
  const byShop = new Map((existing ?? []).map((i) => [i.shop_id, i]));

  // create missing invoices (tagged SEED), collect them
  const toCreate = [];
  for (const s of shops) {
    if (!byShop.has(s.id)) {
      toCreate.push({
        shop_id: s.id, period, amount: s.custom_fee ?? 0, status: "paid",
        paid_at: new Date(Number(period.slice(0, 4)), Number(period.slice(5)) - 1, 15, 12).toISOString(),
        collected_by: collectedBy, note: "SEED",
      });
    }
  }
  for (let i = 0; i < toCreate.length; i += 200) {
    const chunk = toCreate.slice(i, i + 200);
    const { error } = await db.from("invoices").insert(chunk);
    if (error) { console.error(`insert ${period}:`, error.message); process.exit(1); }
    created += chunk.length;
  }

  // mark any pre-existing unpaid invoices for this period as paid+SEED too
  const unpaidIds = (existing ?? []).filter((i) => i.status !== "paid").map((i) => i.id);
  for (let i = 0; i < unpaidIds.length; i += 200) {
    const chunk = unpaidIds.slice(i, i + 200);
    await db.from("invoices").update({
      status: "paid",
      paid_at: new Date(Number(period.slice(0, 4)), Number(period.slice(5)) - 1, 15, 12).toISOString(),
      collected_by: collectedBy, note: "SEED",
    }).in("id", chunk);
    marked += chunk.length;
  }
  console.log(`  ${period}: +${toCreate.length} created, ${unpaidIds.length} existing marked paid`);
}

const { count } = await db.from("invoices").select("id", { count: "exact", head: true }).eq("note", "SEED");
console.log(`\nDone. Seeded invoices tagged SEED: ${count}. (created ${created}, marked ${marked})`);
console.log("To remove later: node unseed-history.mjs");
