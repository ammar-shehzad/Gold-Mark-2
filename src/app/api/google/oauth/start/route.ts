import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getOAuthClient } from "@/lib/googleSheets";

// Route Handlers aren't part of the App Router render pipeline, so
// next/navigation's redirect() (used by lib/auth.ts's requireAdmin())
// doesn't work here — same reason report/pdf and report/csv's route
// handlers do their own manual auth check instead of using it.
export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return NextResponse.redirect(new URL("/collect", req.url));

  try {
    const oauth2Client = getOAuthClient();
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // guarantees a refresh_token is returned even on a re-connect
      scope: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
    });
    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(new URL(`/google-sheets?err=${encodeURIComponent(message)}`, req.url));
  }
}
