import { describe, expect, it } from "vitest";
import { DisplayDevice } from "../../../src/devices/display/display-device";

describe("DisplayDevice", () => {
  it("present copies draft to presented", () => {
    const device = new DisplayDevice({ kind: "display", id: 0 });
    device.applyEffect({
      kind: "display.pixel",
      address: { kind: "display", id: 0 },
      x: 1,
      y: 1,
      on: true,
    });
    expect(device.getPresentedFrameBytes()[1 * 128 + 1]).toBe(0);
    device.applyEffect({
      kind: "display.present",
      address: { kind: "display", id: 0 },
    });
    expect(device.getPresentedFrameBytes()[1 * 128 + 1]).toBe(1);
  });
});
