import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { supabaseServer } from "@/lib/supabase/server";
import { getOAuthClient, ensureSpreadsheetForRefreshToken, encrypt } from "@/lib/googleSheets";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return NextResponse.redirect(new URL("/collect", req.url));

  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/google-sheets?err=Missing+authorization+code", req.url));

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        new URL(
          "/google-sheets?err=Google+did+not+return+a+refresh+token+%E2%80%94+remove+MallPay%27s+access+at+myaccount.google.com%2Fpermissions+and+try+connecting+again",
          req.url
        )
      );
    }
    oauth2Client.setCredentials(tokens);

    const oauth2Info = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userInfo } = await oauth2Info.userinfo.get();

    const { data: existing } = await supabase
      .from("mallpay_google_sheets_settings")
      .select("spreadsheet_id")
      .eq("id", true)
      .single();

    const { spreadsheetId, spreadsheetUrl } = await ensureSpreadsheetForRefreshToken(
      tokens.refresh_token,
      existing?.spreadsheet_id ?? null
    );

    await supabase
      .from("mallpay_google_sheets_settings")
      .update({
        connected: true,
        google_email: userInfo.email ?? null,
        refresh_token: encrypt(tokens.refresh_token),
        spreadsheet_id: spreadsheetId,
        spreadsheet_url: spreadsheetUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);

    return NextResponse.redirect(new URL("/google-sheets?ok=Connected+to+Google+Sheets", req.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(new URL(`/google-sheets?err=${encodeURIComponent(message)}`, req.url));
  }
}
