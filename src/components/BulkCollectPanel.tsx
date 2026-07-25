"use client";
import { useState } from "react";

type Shop = { shop_id: number; shop_number: string; name: string };

/**
 * Bulk collection UI: checkbox list of every shop still pending for the
 * selected month, a select-all, and a confirmation dialog that lists the
 * chosen shops before submitting them all to the bulkCollect server action
 * in one operation.
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
  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(shops.map((s) => s.shop_id)));

  const chosen = shops.filter((s) => selected.has(s.shop_id));

  return (
    <div className="card">
      <div className="widget-head" style={{ marginBottom: 12 }}>
        <h2>Bulk collection · {periodLabel}</h2>
        <a className="btn ghost small" href={`/collect?period=${period}`} style={{ marginLeft: "auto" }}>Exit bulk mode</a>
      </div>

      {shops.length === 0 ? (
        <p className="muted">Every shop is already collected for {periodLabel}. Nothing to bulk-collect.</p>
      ) : (
        <>
          <div className="filters" style={{ marginBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ width: "auto" }} />
              Select all ({shops.length})
            </label>
            <span className="muted" style={{ marginLeft: "auto", alignSelf: "center" }}>{selected.size} selected</span>
            <button className="btn" disabled={selected.size === 0} onClick={() => setConfirming(true)}>
              Mark as Collected
            </button>
          </div>

          <div className="tablewrap fit" style={{ maxHeight: 420, overflowY: "auto" }}>
            <table>
              <tbody>
                {shops.map((s) => (
                  <tr key={s.shop_id}>
                    <td style={{ width: 40 }}>
                      <input type="checkbox" checked={selected.has(s.shop_id)} onChange={() => toggle(s.shop_id)} style={{ width: "auto" }} />
                    </td>
                    <td><strong>{s.shop_number}</strong> · {s.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirming && (
        <div className="sheet-backdrop" onClick={() => !busy && setConfirming(false)} style={{ alignItems: "center" }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, width: "92%", maxHeight: "80vh", overflowY: "auto", margin: 0 }}>
            <h2>Confirm Bulk Collection</h2>
            <p>Are you sure you want to mark the selected shops as collected for <strong>{periodLabel}</strong>?</p>
            <div className="tablewrap fit" style={{ maxHeight: 240, overflowY: "auto", marginBottom: 12 }}>
              <table><tbody>
                {chosen.map((s) => (
                  <tr key={s.shop_id}><td><strong>{s.shop_number}</strong> · {s.name}</td></tr>
                ))}
              </tbody></table>
            </div>
            <form
              action={action}
              onSubmit={() => setBusy(true)}
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              <input type="hidden" name="period" value={period} />
              {chosen.map((s) => (
                <input key={s.shop_id} type="hidden" name="shop_ids" value={s.shop_id} />
              ))}
              <button className="btn" disabled={busy}>
                {busy ? "Collecting…" : `Confirm & Mark as Collected (${chosen.length})`}
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
