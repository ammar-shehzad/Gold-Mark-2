import { MALL_NAME } from "@/lib/util";

// Root route loading boundary. Every page in this app is force-dynamic
// (server-rendered per request against Supabase), so each navigation has a
// real network round-trip — this shows instantly while the next page's
// server render is in flight, instead of the old page sitting frozen.
export default function Loading() {
  return (
    <div className="route-loading" role="status" aria-label="Loading page">
      <span className="mark">{MALL_NAME.charAt(0).toUpperCase()}</span>
      <span className="route-loading-spinner" aria-hidden="true" />
      <span className="route-loading-text">Loading…</span>
    </div>
  );
}
