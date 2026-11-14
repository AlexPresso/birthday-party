/**
 * The colours that follow the host's main colour (`appearance.accent`).
 *
 * Today's "K · Neige" palette is the reference: in the dark theme every shade
 * keeps the hue, saturation and lightness relation it has with #ff6a1f, so the
 * default accent reproduces the original tokens exactly. Text shades are then
 * moved away from the theme's surfaces until they reach WCAG AA (4.5:1), and
 * text laid on the accent is whichever of dark or white contrasts more.
 *
 * The theme's own surfaces, text and borders live in `app/tokens.css`; the
 * root layout renders these values as `--party-*` properties on `<html>`.
 */

export type Theme = "dark" | "light";

export const defaultAccent = "#ff6a1f";

/** The ready-made main colours offered in settings. */
export const accentSwatches = [
  { name: "orange", color: "#ff6a1f" },
  { name: "red", color: "#e5484d" },
  { name: "pink", color: "#e93d82" },
  { name: "violet", color: "#8e4ec6" },
  { name: "blue", color: "#3e63dd" },
  { name: "teal", color: "#12a594" },
  { name: "green", color: "#46a758" },
  { name: "yellow", color: "#ffc53d" },
] as const;

const darkText = "#100f0e";
const lightText = "#ffffff";
const target = 4.5;

// Surfaces that carry accent-coloured text in each theme (tokens.css).
const surfaces: Record<Theme, string[]> = {
  dark: ["#100f0e", "#1b1917", "#292623"],
  light: ["#f7f3ee", "#fffdfa", "#ebe5dd"],
};
// The light theme's soft tint is the accent mixed into its surface.
const lightSurface = "#fffdfa";

type Rgb = [number, number, number];
type Hsl = { h: number; s: number; l: number };

export function isAccent(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function rgb(hex: string): Rgb {
  if (!isAccent(hex)) throw new RangeError(`Invalid colour: ${hex}`);
  return [1, 3, 5].map((index) =>
    parseInt(hex.slice(index, index + 2), 16),
  ) as Rgb;
}

function hex(color: Rgb) {
  return `#${color
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function toHsl([r, g, b]: Rgb): Hsl {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const chroma = max - min;
  if (chroma === 0) return { h: 0, s: 0, l };
  const s = chroma / (1 - Math.abs(2 * l - 1));
  const h =
    max === red
      ? ((green - blue) / chroma + 6) % 6
      : max === green
        ? (blue - red) / chroma + 2
        : (red - green) / chroma + 4;
  return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }: Hsl): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = l - chroma / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function luminance(color: string) {
  const [r, g, b] = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(first: string, second: string) {
  const [light, dark] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}

/** Dark or white, whichever reads better on a filled colour. */
export function textOn(color: string) {
  return contrast(color, lightText) > contrast(color, darkText)
    ? lightText
    : darkText;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** How a shade of today's palette relates to #ff6a1f. */
function relation(shade: string) {
  const accent = toHsl(rgb(defaultAccent));
  const color = toHsl(rgb(shade));
  return {
    h: color.h - accent.h,
    s: color.s / accent.s,
    l: color.l - accent.l,
  };
}

const reference = {
  hover: relation("#ff8242"),
  text: relation("#ff8a4c"),
  soft: relation("#33211a"),
  highlight: relation("#ffb547"),
  highlightPale: relation("#ffe2b0"),
};
// The dark soft tint keeps its own lightness whatever the accent.
const darkSoftLightness = toHsl(rgb("#33211a")).l;

function shade(
  accent: Hsl,
  { h, s, l }: { h: number; s: number; l: number },
  lightness = accent.l + l,
) {
  return hex(
    fromHsl({ h: accent.h + h, s: clamp(accent.s * s), l: clamp(lightness) }),
  );
}

function mix(color: string, base: string, amount: number) {
  const from = rgb(color);
  const to = rgb(base);
  return hex(
    from.map(
      (channel, index) => to[index] + (channel - to[index]) * amount,
    ) as Rgb,
  );
}

/**
 * Moves a colour's lightness away from the theme's surfaces (lighter on dark,
 * darker on light) until it reaches 4.5:1 against all of them.
 */
function readableOn(color: string, theme: Theme, backgrounds: string[]) {
  const hsl = toHsl(rgb(color));
  const step = theme === "dark" ? 0.005 : -0.005;
  let current = color;
  while (
    backgrounds.some((background) => contrast(current, background) < target)
  ) {
    const lightness = clamp(hsl.l + step);
    if (lightness === hsl.l) break;
    hsl.l = lightness;
    current = hex(fromHsl(hsl));
  }
  return current;
}

export type AccentColours = {
  accent: string;
  accentHover: string;
  accentText: string;
  accentTextHover: string;
  onAccent: string;
  accentSoft: string;
  highlight: string;
  highlightPale: string;
  /** False when text on the filled accent, or the accent as text, stays under 4.5:1. */
  readable: boolean;
};

export function accentColours(value: string, theme: Theme): AccentColours {
  const accent = value.toLowerCase();
  const hsl = toHsl(rgb(accent));
  const onAccent = textOn(accent);
  // Hovering moves the fill away from its text, so the label stays readable.
  const hoverLightness =
    hsl.l + (onAccent === darkText ? reference.hover.l : -reference.hover.l);
  const accentHover = shade(hsl, reference.hover, hoverLightness);

  const accentSoft =
    theme === "dark"
      ? shade(hsl, reference.soft, darkSoftLightness)
      : mix(accent, lightSurface, 0.16);
  const backgrounds = [...surfaces[theme], accentSoft];
  const accentText = readableOn(
    theme === "dark" ? shade(hsl, reference.text) : accent,
    theme,
    backgrounds,
  );
  const accentTextHover = readableOn(accentHover, theme, backgrounds);
  const highlight = readableOn(
    shade(hsl, reference.highlight),
    theme,
    surfaces[theme],
  );
  // On light surfaces the pale shade paints discreet snow, so it keeps colour.
  const highlightPale =
    theme === "dark"
      ? shade(hsl, reference.highlightPale)
      : shade(hsl, reference.highlightPale, 0.7);

  const readable =
    contrast(accent, onAccent) >= target &&
    backgrounds.every(
      (background) => contrast(accentText, background) >= target,
    );
  return {
    accent,
    accentHover,
    accentText,
    accentTextHover,
    onAccent,
    accentSoft,
    highlight,
    highlightPale,
    readable,
  };
}

/** The custom properties `tokens.css` reads for the accent-dependent tokens. */
export function accentProperties(accent: string, theme: Theme) {
  const colours = accentColours(accent, theme);
  return {
    "--party-accent": colours.accent,
    "--party-accent-hover": colours.accentHover,
    "--party-accent-text": colours.accentText,
    "--party-accent-text-hover": colours.accentTextHover,
    "--party-on-accent": colours.onAccent,
    "--party-accent-soft": colours.accentSoft,
    "--party-highlight": colours.highlight,
    "--party-highlight-pale": colours.highlightPale,
  };
}
