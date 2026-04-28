import type { DeviceAddress } from "../core/device-address";
import type { SimulationDevice } from "../core/device-bus";
import { AdcDevice } from "./adc-device";
import { DisplayDevice } from "./display/display-device";
import { LedDevice } from "./led-device";
import { SerialDevice } from "./serial-device";

export type DefaultDevices = {
  adc0: AdcDevice;
  serial0: SerialDevice;
  display0: DisplayDevice;
  led0: LedDevice;
};

/**
 * Creates default board devices: adc#0, serial#0, display#0.
 */
export function createDefaultDevices(): DefaultDevices {
  const adc0Address: DeviceAddress = { kind: "adc", id: 0 };
  const serial0Address: DeviceAddress = { kind: "serial", id: 0 };
  const display0Address: DeviceAddress = { kind: "display", id: 0 };
  const led0Address: DeviceAddress = { kind: "led", id: 0 };

  return {
    adc0: new AdcDevice(adc0Address, 512),
    serial0: new SerialDevice(serial0Address),
    display0: new DisplayDevice(display0Address),
    led0: new LedDevice(led0Address),
  };
}

export function registerDefaultDevices(
  register: (address: DeviceAddress, device: SimulationDevice) => void,
  devices: DefaultDevices,
): void {
  register({ kind: "adc", id: 0 }, devices.adc0);
  register({ kind: "serial", id: 0 }, devices.serial0);
  register({ kind: "display", id: 0 }, devices.display0);
  register({ kind: "led", id: 0 }, devices.led0);
}
