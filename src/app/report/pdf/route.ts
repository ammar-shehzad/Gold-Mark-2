import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { MALL_NAME, money, currentPeriod, periodLabel } from "@/lib/util";
import PDFDocument from "pdfkit";

export const dynamic = "force-dynamic";

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
    .select("amount,status,paid_at,shops!inner(shop_number,name,owner_name,floor_id,floors(name)),profiles:collected_by(name)")
    .eq("period", period)
    .order("shop_id");
  if (show === "paid" || show === "unpaid") q = q.eq("status", show);
  if (floor) q = q.eq("shops.floor_id", Number(floor));

  const { data } = await q;
  type R = {
    amount: number; status: string; paid_at: string | null;
    shops: { shop_number: string; name: string; owner_name: string | null; floors: { name: string } };
    profiles: { name: string } | null;
  };
  const rows = (data ?? []) as unknown as R[];
  const collected = rows.filter(r => r.status === "paid").reduce((s, r) => s + Number(r.amount), 0);
  const pending = rows.filter(r => r.status === "unpaid").reduce((s, r) => s + Number(r.amount), 0);

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.fontSize(18).font("Helvetica-Bold").text(`${MALL_NAME} — Maintenance Report`, { align: "center" });
  doc.fontSize(11).font("Helvetica").fillColor("#555").text(periodLabel(period), { align: "center" });
  doc.moveDown(1.2);

  doc.fontSize(10).fillColor("#000");
  doc.text(`Shops: ${rows.length}    Collected: ${money(collected)}    Outstanding: ${money(pending)}`);
  doc.moveDown(0.8);

  // Widths are proportional weights, scaled to fit the actual printable
  // width — previously these were fixed points summing to 615pt against
  // only ~515pt of usable A4 width (with 40pt margins), so the rightmost
  // ~100pt (part of "Paid on" and all of "Collected by") drew past the
  // page edge and got cropped. Scaling keeps the same relative proportions
  // but guarantees the table always fits, regardless of page size/margins.
  const colWeights = [
    { key: "shop", label: "Shop", weight: 130 },
    { key: "floor", label: "Floor", weight: 80 },
    { key: "owner", label: "Owner", weight: 110 },
    { key: "amount", label: "Amount", weight: 70 },
    { key: "status", label: "Status", weight: 55 },
    { key: "paid", label: "Paid on", weight: 80 },
    { key: "by", label: "Collected by", weight: 90 },
  ];
  const printableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWeight = colWeights.reduce((s, c) => s + c.weight, 0);
  const cols = colWeights.map((c) => ({ ...c, width: (c.weight / totalWeight) * printableWidth }));
  const startX = doc.page.margins.left;
  let y = doc.y;

  function drawHeader() {
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#fff");
    doc.rect(startX, y, cols.reduce((s, c) => s + c.width, 0), 18).fill("#0e6b52");
    let x = startX;
    for (const c of cols) {
      doc.fillColor("#fff").text(c.label, x + 4, y + 5, { width: c.width - 8 });
      x += c.width;
    }
    y += 18;
    doc.fillColor("#000").font("Helvetica").fontSize(9);
  }

  drawHeader();
  for (const r of rows) {
    if (y > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }
    const values = [
      r.shops.shop_number + " · " + r.shops.name,
      r.shops.floors.name,
      r.shops.owner_name ?? "—",
      money(r.amount),
      r.status === "paid" ? "Paid" : "Unpaid",
      r.paid_at ? new Date(r.paid_at).toLocaleDateString("en-US", { day: "numeric", month: "short" }) : "—",
      r.profiles?.name ?? "—",
    ];
    let x = startX;
    for (let i = 0; i < cols.length; i++) {
      doc.text(values[i], x + 4, y + 4, { width: cols[i].width - 8 });
      x += cols[i].width;
    }
    doc.moveTo(startX, y + 18).lineTo(startX + cols.reduce((s, c) => s + c.width, 0), y + 18).strokeColor("#e3e1d8").stroke();
    y += 18;
  }

  doc.end();
  const buffer = await done;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="maintenance-${period}.pdf"`,
    },
  });
}
