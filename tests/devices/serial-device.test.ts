import { describe, expect, it } from "vitest";
import { DeviceBus } from "../../src/core/device-bus";
import { SerialDevice } from "../../src/devices/serial-device";

describe("SerialDevice", () => {
  it("buffers println output", () => {
    const bus = new DeviceBus();
    const serial = new SerialDevice({ kind: "serial", id: 0 });
    bus.registerDevice({ kind: "serial", id: 0 }, serial);
    bus.applyEffect({
      kind: "serial.println",
      address: { kind: "serial", id: 0 },
      text: "hello",
    });
    expect(serial.takeOutputLines()).toEqual(["hello"]);
  });
});
