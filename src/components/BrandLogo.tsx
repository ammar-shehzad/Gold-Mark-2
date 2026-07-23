import { MALL_NAME } from "@/lib/util";

/**
 * Mall logo that switches between the light and dark variant purely with
 * CSS (html[data-theme="dark"]) - no client JS, so it renders correctly
 * on the server and never flashes the wrong version.
 */
export default function BrandLogo({ height = 40 }: { height?: number }) {
  return (
    <span className="brand-logo" style={{ height }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-light.png" alt={MALL_NAME} className="brand-logo-light" style={{ height }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-dark.png" alt={MALL_NAME} className="brand-logo-dark" style={{ height }} />
    </span>
  );
}
