import { describe, expect, it } from "vitest";
import { formatDeviceAddress, parseDeviceAddress } from "../../src/core/device-address";

describe("parseDeviceAddress", () => {
  it("parses adc#0 and display#0", () => {
    expect(parseDeviceAddress("adc#0")).toEqual({
      ok: true,
      address: { kind: "adc", id: 0 },
    });
    expect(parseDeviceAddress("display#0")).toEqual({
      ok: true,
      address: { kind: "display", id: 0 },
    });
  });

  it("rejects invalid format", () => {
    expect(parseDeviceAddress("foo")).toEqual({ ok: false, reason: "invalid_format" });
  });

  it("formats address", () => {
    expect(
      formatDeviceAddress({ kind: "serial", id: 0 }),
    ).toBe("serial#0");
  });
});
