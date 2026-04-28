import { describe, expect, it } from "vitest";
import { AdcDevice } from "../../src/devices/adc-device";

describe("AdcDevice", () => {
  it("returns simulated raw", () => {
    const adc = new AdcDevice({ kind: "adc", id: 0 }, 713);
    expect(
      adc.readProperty({
        address: { kind: "adc", id: 0 },
        property: "",
      })?.tag,
    ).toBe("integer");
    expect(adc.getSimulatedRawValue()).toBe(713);
  });
});
