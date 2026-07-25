// Removes every seeded historical invoice (note='SEED') created by
// seed-history.mjs, restoring the database to real data only.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { count: before } = await db.from("invoices").select("id", { count: "exact", head: true }).eq("note", "SEED");
console.log(`Seeded invoices to remove: ${before}`);
const { error } = await db.from("invoices").delete().eq("note", "SEED");
if (error) { console.error("delete failed:", error.message); process.exit(1); }
const { count: after } = await db.from("invoices").select("id", { count: "exact", head: true }).eq("note", "SEED");
console.log(`Removed. Remaining SEED invoices: ${after}`);
