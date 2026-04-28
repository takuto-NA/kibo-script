import { describe, expect, it } from "vitest";
import { DisplayDevice } from "../../../src/devices/display/display-device";
import { TOTAL_PIXEL_COUNT } from "../../../src/devices/display/display-constants";

describe("display golden", () => {
  it("line from corner to corner sets expected pixels", () => {
    const device = new DisplayDevice({ kind: "display", id: 0 });
    device.applyEffect({
      kind: "display.clear",
      address: { kind: "display", id: 0 },
    });
    device.applyEffect({
      kind: "display.line",
      address: { kind: "display", id: 0 },
      x0: 0,
      y0: 0,
      x1: 127,
      y1: 63,
    });
    device.applyEffect({
      kind: "display.present",
      address: { kind: "display", id: 0 },
    });
    const frame = device.getPresentedFrameBytes();
    expect(frame.length).toBe(TOTAL_PIXEL_COUNT);
    const onCount = frame.reduce(
      (count: number, b: number) => count + (b === 1 ? 1 : 0),
      0,
    );
    expect(onCount).toBeGreaterThan(10);
  });
});
