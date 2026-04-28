import { describe, expect, it } from "vitest";
import { TOTAL_PIXEL_COUNT } from "../../src/devices/display/display-constants";
import {
  buildDisplayFrameRgbaBytes,
  DISPLAY_PIXEL_OFF_RGBA,
  DISPLAY_PIXEL_ON_RGBA,
} from "../../src/ui/display-frame-rgba";

const RGBA_CHANNEL_COUNT = 4;

/**
 * Verifies OLED visual output without starting a server or taking screenshots.
 */
describe("buildDisplayFrameRgbaBytes", () => {
  it("converts off and on pixels to stable RGBA bytes", () => {
    const frameBytes = new Uint8Array(TOTAL_PIXEL_COUNT);
    frameBytes[1] = 1;

    const rgbaBytes = buildDisplayFrameRgbaBytes(frameBytes);

    expect(rgbaBytes.length).toBe(TOTAL_PIXEL_COUNT * RGBA_CHANNEL_COUNT);
    expect(Array.from(rgbaBytes.slice(0, RGBA_CHANNEL_COUNT))).toEqual([
      DISPLAY_PIXEL_OFF_RGBA.red,
      DISPLAY_PIXEL_OFF_RGBA.green,
      DISPLAY_PIXEL_OFF_RGBA.blue,
      DISPLAY_PIXEL_OFF_RGBA.alpha,
    ]);
    expect(
      Array.from(rgbaBytes.slice(RGBA_CHANNEL_COUNT, RGBA_CHANNEL_COUNT * 2)),
    ).toEqual([
      DISPLAY_PIXEL_ON_RGBA.red,
      DISPLAY_PIXEL_ON_RGBA.green,
      DISPLAY_PIXEL_ON_RGBA.blue,
      DISPLAY_PIXEL_ON_RGBA.alpha,
    ]);
  });

  it("rejects invalid frame length", () => {
    expect(() => buildDisplayFrameRgbaBytes(new Uint8Array(1))).toThrow(
      "Display frame length mismatch.",
    );
  });
});
