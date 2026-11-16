const flame = "M62.5 22C78 42 76 56 62.5 58C49 56 47 42 62.5 22Z";
const glow = "M62.5 38C69 47 68 54 62.5 55C57 54 56 47 62.5 38Z";

// Three striped candles of different heights, on a 125-unit tile each.
const candles = [
  {
    transform: "translate(4.84 20) scale(0.2) translate(-62.5 -106)",
    flame: "translate(0 8)",
    y: 72,
    height: 34,
    stripes: "M54 83.7L71 78.3M54 97.7L71 92.3",
  },
  {
    transform: "translate(9.4 20) scale(0.24) translate(-62.5 -106)",
    flame: "translate(0 0)",
    y: 64,
    height: 42,
    stripes: "M54 75.7L71 70.3M54 89.7L71 84.3",
  },
  {
    transform: "translate(13.74 20) scale(0.18) translate(-62.5 -106)",
    flame: "translate(0 16)",
    y: 80,
    height: 26,
    stripes: "M54 91.7L71 86.3",
  },
];

/** The app's mark: three birthday candles lit in the theme colours. */
export function BrandMark() {
  return (
    <svg
      className="brand-mark"
      width="22"
      height="24"
      viewBox="0 0 18 20"
      aria-hidden="true"
    >
      {candles.map((candle) => (
        <g key={candle.transform} transform={candle.transform}>
          <g transform={candle.flame}>
            <path d={flame} style={{ fill: "var(--accent)" }} />
            <path d={glow} style={{ fill: "var(--highlight)" }} />
          </g>
          <rect
            x="53"
            y={candle.y}
            width="19"
            height={candle.height}
            rx="6"
            style={{ fill: "var(--highlight-pale)" }}
          />
          <path
            d={candle.stripes}
            strokeWidth="4"
            style={{ stroke: "var(--accent)" }}
          />
        </g>
      ))}
    </svg>
  );
}
