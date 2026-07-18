import { NextRequest, NextResponse } from "next/server";
import { runFullSync } from "@/lib/googleSheets";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Trigger-agnostic: works with Vercel Cron (which sends this header
// automatically when CRON_SECRET is set) or a plain cron line on any
// server (`curl -H "Authorization: Bearer $CRON_SECRET" .../api/google/sync`).
// The in-app "Sync now" button calls runFullSync() directly instead of
// hitting this route, so it doesn't need the secret and isn't affected by
// the sync_enabled pause toggle below (a manual click is always intentional).
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: settings } = await admin.from("mallpay_google_sheets_settings").select("sync_enabled").eq("id", true).single();
  if (!settings?.sync_enabled) {
    return NextResponse.json({ ok: true, skipped: "sync_disabled" });
  }

  try {
    const result = await runFullSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
