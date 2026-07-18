export function DonutChart({
  segments,
  centerLabel,
  centerValue,
  size = 160,
  strokeWidth = 18,
}: {
  segments: { label: string; value: number; color: string }[];
  centerLabel?: string;
  centerValue?: string;
  size?: number;
  strokeWidth?: number;
}) {
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;

  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {total <= 0 ? (
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--line)" strokeWidth={strokeWidth} />
          ) : (
            segments.map((seg, i) => {
              if (seg.value <= 0) return null;
              const len = (seg.value / total) * circumference;
              const dashoffset = -cumulative;
              cumulative += len;
              return (
                <circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${len} ${circumference - len}`}
                  strokeDashoffset={dashoffset}
                >
                  <title>{`${seg.label}: ${seg.value}`}</title>
                </circle>
              );
            })
          )}
        </g>
      </svg>
      {(centerLabel || centerValue) && (
        <div className="donut-center">
          {centerValue && <div className="donut-center-value num">{centerValue}</div>}
          {centerLabel && <div className="donut-center-label muted">{centerLabel}</div>}
        </div>
      )}
    </div>
  );
}
