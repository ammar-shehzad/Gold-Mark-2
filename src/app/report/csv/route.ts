import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { currentPeriod } from "@/lib/util";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return NextResponse.redirect(new URL("/collect", req.url));

  const p = req.nextUrl.searchParams;
  const period = /^\d{4}-\d{2}$/.test(p.get("period") ?? "") ? p.get("period")! : currentPeriod();
  const show = p.get("show");
  const floor = p.get("floor");

  let q = supabase
    .from("invoices")
    .select("amount,status,paid_at,note,shops!inner(shop_number,name,owner_name,owner_phone,floor_id,floors(name)),profiles:collected_by(name)")
    .eq("period", period)
    .order("shop_id");
  if (show === "paid" || show === "unpaid") q = q.eq("status", show);
  if (floor) q = q.eq("shops.floor_id", Number(floor));

  const { data } = await q;
  type R = {
    amount: number; status: string; paid_at: string | null; note: string | null;
    shops: { shop_number: string; name: string; owner_name: string | null; owner_phone: string | null; floors: { name: string } };
    profiles: { name: string } | null;
  };
  const rows = (data ?? []) as unknown as R[];

  const lines = [
    ["Shop number", "Shop name", "Floor", "Owner", "Phone", "Amount", "Status", "Paid on", "Collected by", "Note"].join(","),
    ...rows.map(r =>
      [
        r.shops.shop_number, r.shops.name, r.shops.floors.name,
        r.shops.owner_name, r.shops.owner_phone,
        r.amount, r.status, r.paid_at, r.profiles?.name, r.note,
      ].map(csvCell).join(",")
    ),
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="maintenance-${period}.csv"`,
    },
  });
}
