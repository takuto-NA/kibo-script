import {
  DISPLAY_HEIGHT_PIXELS,
  DISPLAY_WIDTH_PIXELS,
} from "../devices/display/display-constants";
import { buildDisplayFrameRgbaBytes } from "./display-frame-rgba";

/**
 * Renders 128×64 1-bit framebuffer bytes onto a canvas (scaled via CSS).
 */
export function renderDisplayFrameToCanvas(
  canvas: HTMLCanvasElement,
  frameBytes: Uint8Array,
): void {
  canvas.width = DISPLAY_WIDTH_PIXELS;
  canvas.height = DISPLAY_HEIGHT_PIXELS;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("Canvas 2D context unavailable.");
  }
  const imageData = context.createImageData(DISPLAY_WIDTH_PIXELS, DISPLAY_HEIGHT_PIXELS);
  imageData.data.set(buildDisplayFrameRgbaBytes(frameBytes));
  context.putImageData(imageData, 0, 0);
}
