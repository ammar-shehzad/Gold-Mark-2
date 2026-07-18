import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  icon,
  tone,
  sub,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  tone?: "good" | "bad" | "hero";
  sub?: ReactNode;
}) {
  const isHero = tone === "hero";
  const modifier = tone && !isHero ? ` ${tone}` : "";
  return (
    <div className={"kpi" + (isHero ? " featured" : "")}>
      {icon && <div className={"kpi-icon" + modifier}>{icon}</div>}
      <div className="kpi-body">
        <div className="kpi-label">{label}</div>
        <div className={"kpi-value" + modifier}>{value}</div>
        {sub && <div className="kpi-sub muted">{sub}</div>}
      </div>
    </div>
  );
}
