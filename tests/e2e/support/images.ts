import type { Page } from "@playwright/test";

type CanvasImage = {
  name?: string;
  width?: number;
  height?: number;
  /** The gradient's first color; vary it to tell two fixtures apart. */
  color?: string;
};

/**
 * Draws a small PNG in the page: a diagonal gradient with a pale disc and a
 * dark block, so crops, thumbnails and screenshots stay recognizable. Nothing
 * is read from disk and no real photograph is involved.
 */
export async function canvasImage(
  page: Page,
  {
    name = "fixture.png",
    width = 480,
    height = 320,
    color = "#91729d",
  }: CanvasImage = {},
) {
  const data = await page.evaluate(
    ({ width, height, color }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const drawing = canvas.getContext("2d")!;
      const gradient = drawing.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, "#2a2030");
      drawing.fillStyle = gradient;
      drawing.fillRect(0, 0, width, height);
      const unit = Math.min(width, height);
      drawing.fillStyle = "#efd8b5";
      drawing.beginPath();
      drawing.arc(width * 0.4, height * 0.4, unit * 0.22, 0, Math.PI * 2);
      drawing.fill();
      drawing.fillStyle = "#302235";
      drawing.fillRect(width * 0.55, height * 0.5, unit * 0.35, unit * 0.35);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { width, height, color },
  );
  return { name, mimeType: "image/png", buffer: Buffer.from(data, "base64") };
}
