export function LineChart({
  points,
  height = 180,
}: {
  points: { label: string; value: number }[];
  height?: number;
}) {
  const width = 600;
  const padding = 20;
  const max = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    x: padding + i * stepX,
    y: height - padding - (p.value / max) * (height - padding * 2),
    ...p,
  }));

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  const last = coords[coords.length - 1];
  const areaPath =
    coords.length > 0 ? `${linePath} L${last.x},${height - padding} L${padding},${height - padding} Z` : "";

  return (
    <div className="linechart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {coords.length > 0 && <path d={areaPath} fill="url(#trendFill)" stroke="none" />}
        {coords.length > 1 && <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2.5} />}
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={3.5} fill="var(--accent)">
            <title>{`${c.label}: ${c.value}`}</title>
          </circle>
        ))}
      </svg>
      <div className="linechart-labels muted">
        {points.map((p, i) => (
          <span key={i}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}
