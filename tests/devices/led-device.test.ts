import { describe, expect, it } from "vitest";
import { DeviceBus } from "../../src/core/device-bus";
import { LedDevice } from "../../src/devices/led-device";

describe("LedDevice", () => {
  it("applies on, off, and toggle effects", () => {
    const deviceBus = new DeviceBus();
    const ledDevice = new LedDevice({ kind: "led", id: 0 });
    deviceBus.registerDevice({ kind: "led", id: 0 }, ledDevice);

    expect(ledDevice.isOn()).toBe(false);

    deviceBus.applyEffect({ kind: "led.on", address: { kind: "led", id: 0 } });
    expect(ledDevice.isOn()).toBe(true);

    deviceBus.applyEffect({ kind: "led.off", address: { kind: "led", id: 0 } });
    expect(ledDevice.isOn()).toBe(false);

    deviceBus.applyEffect({ kind: "led.toggle", address: { kind: "led", id: 0 } });
    expect(ledDevice.isOn()).toBe(true);

    deviceBus.applyEffect({ kind: "led.toggle", address: { kind: "led", id: 0 } });
    expect(ledDevice.isOn()).toBe(false);
  });
});
