import { describe, expect, it } from "vitest";
import { DisplayBuffer128x64 } from "../../../src/devices/display/display-buffer";
import { TOTAL_PIXEL_COUNT } from "../../../src/devices/display/display-constants";

describe("DisplayBuffer128x64", () => {
  it("sets and reads pixel", () => {
    const buffer = new DisplayBuffer128x64();
    expect(buffer.setPixel(10, 10, true)).toBe(true);
    expect(buffer.getPixel(10, 10)).toBe(true);
    expect(buffer.setPixel(-1, 0, true)).toBe(false);
  });

  it("frame length matches total pixels", () => {
    const buffer = new DisplayBuffer128x64();
    expect(buffer.getFrameBytes().length).toBe(TOTAL_PIXEL_COUNT);
  });
});
