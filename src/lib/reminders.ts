import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Cancels any not-yet-sent WhatsApp reminder queued for this invoice — call
 * right after an invoice is marked paid. Uses the service-role client: there
 * is no `update` RLS policy on mallpay_whatsapp_outbox for authenticated
 * users (only `insert` and an admin-only `select`), so a normal server
 * client would silently affect 0 rows here.
 */
export async function cancelPendingReminders(invoiceId: number): Promise<void> {
  const admin = supabaseAdmin();
  await admin
    .from("mallpay_whatsapp_outbox")
    .update({ status: "cancelled" })
    .eq("related_table", "invoices")
    .eq("related_id", invoiceId)
    .eq("status", "pending");
}
