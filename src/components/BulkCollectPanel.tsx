"use client";
import { useState } from "react";

type Shop = { shop_id: number; shop_number: string; name: string; floor: string; amount: number };

const money = (n: number) => `Rs ${Number(n).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/**
 * Bulk collection: the same table as the normal view, but every pending row
 * gets a checkbox in the FIRST column. A sticky bar tracks the count and
 * opens a confirm dialog listing the chosen shops before submitting them all
 * to the bulkCollect server action in one operation.
 */
export default function BulkCollectPanel({
  shops,
  period,
  periodLabel,
  action,
}: {
  shops: Shop[];
  period: string;
  periodLabel: string;
  action: (formData: FormData) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const allChecked = shops.length > 0 && selected.size === shops.length;
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(shops.map((s) => s.shop_id)));
  const chosen = shops.filter((s) => selected.has(s.shop_id));
  const chosenTotal = chosen.reduce((s, x) => s + x.amount, 0);

  if (shops.length === 0) {
    return (
      <div className="card">
        <p className="muted">Every shop is already collected for {periodLabel}. Nothing to bulk-collect.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="bulk-bar">
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontWeight: 600 }}>
          <input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ width: "auto" }} />
          Select all ({shops.length})
        </label>
        <span className="muted">{selected.size} selected · {money(chosenTotal)}</span>
        <button className="btn" disabled={selected.size === 0} onClick={() => setConfirming(true)} style={{ marginLeft: "auto" }}>
          Mark as Collected
        </button>
      </div>

      <div className="tablewrap"><table>
        <thead><tr><th style={{ width: 44 }}></th><th>Shop</th><th className="r">Amount</th><th className="r">Status</th></tr></thead>
        <tbody>
          {shops.map((s) => (
            <tr key={s.shop_id} className={selected.has(s.shop_id) ? "row-selected" : ""} onClick={() => toggle(s.shop_id)} style={{ cursor: "pointer" }}>
              <td onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selected.has(s.shop_id)} onChange={() => toggle(s.shop_id)} style={{ width: "auto" }} />
              </td>
              <td><strong>{s.shop_number}</strong> · {s.name}<div className="rowsub">{s.floor}</div></td>
              <td className="r num">{money(s.amount)}</td>
              <td className="r"><span className="badge unpaid">Pending</span></td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {confirming && (
        <div className="sheet-backdrop" onClick={() => !busy && setConfirming(false)} style={{ alignItems: "center" }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, width: "92%", maxHeight: "82vh", overflowY: "auto", margin: 0 }}>
            <h2>Confirm Bulk Collection</h2>
            <p>Are you sure you want to mark the selected shops as collected for <strong>{periodLabel}</strong>?</p>
            <p className="muted" style={{ marginTop: -6 }}>{chosen.length} shop(s) · total {money(chosenTotal)}</p>
            <div className="tablewrap fit" style={{ maxHeight: 240, overflowY: "auto", marginBottom: 12 }}>
              <table><tbody>
                {chosen.map((s) => (
                  <tr key={s.shop_id}><td><strong>{s.shop_number}</strong> · {s.name}</td><td className="r num">{money(s.amount)}</td></tr>
                ))}
              </tbody></table>
            </div>
            <form action={action} onSubmit={() => setBusy(true)} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input type="hidden" name="period" value={period} />
              {chosen.map((s) => <input key={s.shop_id} type="hidden" name="shop_ids" value={s.shop_id} />)}
              <button className="btn" disabled={busy}>{busy ? "Collecting…" : `Confirm & Mark as Collected (${chosen.length})`}</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
