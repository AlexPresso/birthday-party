import type { CSSProperties } from "react";

// Integer hashing keeps the flakes identical between server and browser renders.
function fraction(index: number, salt: number) {
  let value =
    (Math.imul(index + 1, 0x9e3779b1) + Math.imul(salt, 0x85ebca6b)) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x2c1b3c6d) >>> 0;
  value ^= value >>> 13;
  // XOR yields a signed integer; read it back as unsigned for a 0–1 fraction.
  return (value >>> 0) / 0x100000000;
}

/**
 * Decorative snowfall behind a page header. The parent sets `--snow-height`
 * and must be positioned; flakes fade out before they reach the content.
 */
export function Snow({ count }: { count: number }) {
  return (
    <div className="snow" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => {
        const size = (1.6 + fraction(index, 1) * 3.2).toFixed(2);
        const duration = 9 + fraction(index, 2) * 10;
        const progress = fraction(index, 3);
        const style = {
          left: `${(fraction(index, 4) * 100).toFixed(2)}%`,
          width: `${size}px`,
          height: `${size}px`,
          opacity: (0.25 + fraction(index, 5) * 0.6).toFixed(2),
          animationDuration: `${duration.toFixed(2)}s`,
          animationDelay: `-${(progress * duration).toFixed(2)}s`,
          "--snow-rest": `${(progress * 100).toFixed(2)}%`,
        } as CSSProperties;
        return (
          <span
            key={index}
            className={fraction(index, 6) < 0.2 ? "snow-warm" : undefined}
            style={style}
          />
        );
      })}
    </div>
  );
}
