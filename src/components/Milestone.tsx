/**
 * The app's signature element: an Indian national-highway milestone —
 * white stone, yellow dome — that reports packing progress instead of
 * kilometres. The stone "fills" from the ground up as you pack.
 */
export function Milestone({
  pct,
  label,
  caption = 'packed',
  size = 92,
  onSign = false,
}: {
  pct: number;
  label: string;
  caption?: string;
  size?: number;
  onSign?: boolean;
}) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const w = 92;
  const h = 122;
  const top = 50; // where the dome meets the body
  const bodyH = 112 - top;
  const fillH = (bodyH * p) / 100;
  const short = label.length > 9 ? label.slice(0, 8) + '…' : label;
  const id = `ms-${short.replace(/[^a-z0-9]/gi, '')}-${p}`;
  return (
    <svg
      className="milestone"
      width={size}
      height={(size * h) / w}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`${p}% ${caption}${label ? ` for ${label}` : ''}`}
    >
      <defs>
        <clipPath id={id}>
          <path d={`M8 112 V${top} A38 38 0 0 1 84 ${top} V112 Z`} />
        </clipPath>
      </defs>
      <ellipse cx="46" cy="114" rx="44" ry="5" fill={onSign ? 'rgba(0,0,0,0.25)' : 'rgba(35,41,46,0.15)'} />
      <g clipPath={`url(#${id})`}>
        <rect x="0" y="0" width={w} height={h} fill="#ffffff" />
        <rect x="0" y={112 - fillH} width={w} height={fillH} fill="#d9eee4" />
        <path d={`M8 ${top} A38 38 0 0 1 84 ${top} Z`} fill="#F2B705" />
      </g>
      <path d={`M8 112 V${top} A38 38 0 0 1 84 ${top} V112 Z`} fill="none" stroke="#23292e" strokeOpacity="0.85" strokeWidth="2.5" />
      <line x1="8" y1={top} x2="84" y2={top} stroke="#23292e" strokeOpacity="0.85" strokeWidth="2" />
      <text x="46" y={top - 12} textAnchor="middle" fontSize={short.length > 6 ? 11 : 13} fontWeight="800" fill="#2a2306">
        {short}
      </text>
      <text x="46" y={top + 34} textAnchor="middle" fontSize="27" fontWeight="800" fill="#23292e" className="num">
        {p}
        <tspan fontSize="14" dx="1">
          %
        </tspan>
      </text>
      <text x="46" y={top + 50} textAnchor="middle" fontSize="11" fontWeight="700" fill="#4b5560">
        {caption}
      </text>
    </svg>
  );
}
