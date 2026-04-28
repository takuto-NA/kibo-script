import { TOTAL_PIXEL_COUNT } from "../devices/display/display-constants";

export const DISPLAY_PIXEL_ON_RGBA = {
  red: 0x43,
  green: 0xa8,
  blue: 0x47,
  alpha: 0xff,
} as const;

export const DISPLAY_PIXEL_OFF_RGBA = {
  red: 0x10,
  green: 0x10,
  blue: 0x10,
  alpha: 0xff,
} as const;

const RGBA_CHANNEL_COUNT = 4;

/**
 * Converts a 1-bit display frame into RGBA bytes without requiring DOM or canvas.
 */
export function buildDisplayFrameRgbaBytes(frameBytes: Uint8Array): Uint8ClampedArray {
  if (frameBytes.length !== TOTAL_PIXEL_COUNT) {
    throw new Error("Display frame length mismatch.");
  }

  const rgbaBytes = new Uint8ClampedArray(TOTAL_PIXEL_COUNT * RGBA_CHANNEL_COUNT);
  let writeIndex = 0;

  for (const frameByte of frameBytes) {
    const pixelColor =
      frameByte === 1 ? DISPLAY_PIXEL_ON_RGBA : DISPLAY_PIXEL_OFF_RGBA;
    rgbaBytes[writeIndex] = pixelColor.red;
    rgbaBytes[writeIndex + 1] = pixelColor.green;
    rgbaBytes[writeIndex + 2] = pixelColor.blue;
    rgbaBytes[writeIndex + 3] = pixelColor.alpha;
    writeIndex += RGBA_CHANNEL_COUNT;
  }

  return rgbaBytes;
}
