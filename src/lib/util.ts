export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY || "Rs";
export const MALL_NAME = process.env.NEXT_PUBLIC_MALL_NAME || "Shopping Mall";

export function money(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return `${CURRENCY} ${v.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function periodLabel(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}
