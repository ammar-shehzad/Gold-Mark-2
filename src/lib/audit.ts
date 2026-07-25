import { supabaseAdmin } from "@/lib/supabase/admin";

export type AuditAction = "collect" | "edit" | "undo" | "bulk_collect" | "advance_collect";

export type AuditEntry = {
  invoice_id?: number | null;
  shop_number?: string | null;
  period?: string | null;
  action: AuditAction;
  old_status?: string | null;
  new_status?: string | null;
  old_amount?: number | null;
  new_amount?: number | null;
  old_paid_at?: string | null;
  new_paid_at?: string | null;
  changed_by?: string | null;
  note?: string | null;
};

/**
 * Records a collection change to mallpay_collection_audit. Best-effort: if
 * the audit table doesn't exist yet (migration not run), supabase-js returns
 * an error object rather than throwing, and we ignore it - a missing audit
 * row must never fail the actual collection.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  const admin = supabaseAdmin();
  await admin.from("mallpay_collection_audit").insert(entry);
}
