import test from "node:test";
import assert from "node:assert/strict";
import {
  accentColours,
  accentProperties,
  accentSwatches,
  contrast,
  defaultAccent,
} from "../src/features/party/appearance.ts";

const lightSurfaces = ["#f7f3ee", "#fffdfa", "#ebe5dd"];
const darkSurfaces = ["#100f0e", "#1b1917", "#292623"];

test("the default accent in the dark theme reproduces the original tokens", () => {
  assert.deepEqual(accentProperties(defaultAccent, "dark"), {
    "--party-accent": "#ff6a1f",
    "--party-accent-hover": "#ff8242",
    "--party-accent-text": "#ff8a4c",
    "--party-accent-text-hover": "#ff8242",
    "--party-on-accent": "#100f0e",
    "--party-accent-soft": "#33211a",
    "--party-highlight": "#ffb547",
    "--party-highlight-pale": "#ffe2b0",
  });
  assert.equal(accentColours("#FF6A1F", "dark").accent, "#ff6a1f");
});

test("text on a filled accent is dark or white, whichever contrasts more", () => {
  assert.equal(accentColours("#ffc53d", "dark").onAccent, "#100f0e");
  assert.equal(accentColours("#ffc53d", "light").onAccent, "#100f0e");
  assert.equal(accentColours("#3e63dd", "dark").onAccent, "#ffffff");
  assert.equal(accentColours("#3e63dd", "light").onAccent, "#ffffff");
  assert.equal(accentColours("#fffbe6", "light").onAccent, "#100f0e");
  // Hovering moves the fill away from its text.
  assert.ok(
    contrast(accentColours("#3e63dd", "dark").accentHover, "#ffffff") >
      contrast("#3e63dd", "#ffffff"),
  );
  assert.ok(
    contrast(accentColours("#ffc53d", "dark").accentHover, "#100f0e") >
      contrast("#ffc53d", "#100f0e"),
  );
});

test("accent text reaches AA on the theme's surfaces for every swatch", () => {
  for (const { color } of accentSwatches) {
    for (const [theme, surfaces] of [
      ["dark", darkSurfaces],
      ["light", lightSurfaces],
    ] as const) {
      const colours = accentColours(color, theme);
      assert.equal(colours.readable, true, `${color} ${theme}`);
      assert.ok(contrast(colours.accent, colours.onAccent) >= 4.5);
      const pairs = [
        ...[...surfaces, colours.accentSoft].flatMap((surface) => [
          [colours.accentText, surface],
          [colours.accentTextHover, surface],
        ]),
        ...surfaces.map((surface) => [colours.highlight, surface]),
      ];
      for (const [text, surface] of pairs) {
        assert.ok(
          contrast(text, surface) >= 4.5,
          `${color} ${theme}: ${text} on ${surface}`,
        );
      }
    }
  }
  // Yellow on light surfaces turns into a dark amber to stay readable.
  const yellow = accentColours("#ffc53d", "light");
  assert.ok(contrast("#ffc53d", "#fffdfa") < 4.5);
  assert.ok(contrast(yellow.accentText, "#fffdfa") >= 4.5);
});

test("a colour that no text can be read on is reported", () => {
  // Under 4.5:1 with both dark and white text.
  const colours = accentColours("#c06000", "dark");
  assert.equal(colours.readable, false);
  assert.ok(contrast("#c06000", colours.onAccent) < 4.5);
});

test("only six-digit hex colours are accepted", () => {
  for (const value of ["", "#fff", "ff6a1f", "#ff6a1g", "#ff6a1f00", "red"]) {
    assert.throws(() => accentColours(value, "dark"), RangeError);
  }
});
