"use client";
import { useState } from "react";

function lastDay(m: string): string {
  if (!/^\d{4}-\d{2}$/.test(m)) return "";
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`;
}

/**
 * Month picker + a day picker that is constrained (min/max) to whatever month
 * is currently chosen, so the admin can only pick a day that belongs to the
 * selected month. Changing the month clears a day that no longer fits. Both
 * inputs submit as `period` (YYYY-MM) and `day` (YYYY-MM-DD) in the GET form.
 */
export default function MonthDayFilter({ period, day }: { period: string; day: string }) {
  const [m, setM] = useState(period);
  const [d, setD] = useState(day);
  const min = /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : undefined;
  const max = lastDay(m) || undefined;

  return (
    <>
      <span className="filter-field">
        <label>Month</label>
        <input
          type="month"
          name="period"
          value={m}
          onChange={(e) => {
            setM(e.target.value);
            if (d && d.slice(0, 7) !== e.target.value) setD("");
          }}
        />
      </span>
      <span className="filter-field">
        <label>Day in {m ? new Date(m + "-01T12:00:00").toLocaleDateString("en-US", { month: "short" }) : "month"}</label>
        <input type="date" name="day" value={d} min={min} max={max} onChange={(e) => setD(e.target.value)} title="Optional — see collections made on this exact date" />
      </span>
    </>
  );
}
