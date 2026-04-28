import type { DeviceAddress } from "./device-address";
import { formatDeviceAddress } from "./device-address";
import type { ScriptValue } from "./value";

export type DeviceEffect =
  | {
      kind: "serial.println";
      address: DeviceAddress;
      text: string;
    }
  | {
      kind: "display.clear";
      address: DeviceAddress;
    }
  | {
      kind: "display.pixel";
      address: DeviceAddress;
      x: number;
      y: number;
      on: boolean;
    }
  | {
      kind: "display.line";
      address: DeviceAddress;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    }
  | {
      kind: "display.circle";
      address: DeviceAddress;
      centerX: number;
      centerY: number;
      radius: number;
    }
  | {
      kind: "display.present";
      address: DeviceAddress;
    };

export type DeviceReadRequest = {
  address: DeviceAddress;
  property: string;
};

export interface SimulationDevice {
  readProperty(request: DeviceReadRequest): ScriptValue | undefined;
  applyEffect(effect: DeviceEffect): void;
}

function addressKey(address: DeviceAddress): string {
  return formatDeviceAddress(address);
}

export class DeviceBus {
  private readonly devices: Map<string, SimulationDevice> = new Map();

  public registerDevice(address: DeviceAddress, device: SimulationDevice): void {
    this.devices.set(addressKey(address), device);
  }

  public getDevice(address: DeviceAddress): SimulationDevice | undefined {
    return this.devices.get(addressKey(address));
  }

  public read(request: DeviceReadRequest): ScriptValue | undefined {
    const device = this.getDevice(request.address);
    if (device === undefined) {
      return undefined;
    }
    return device.readProperty(request);
  }

  public applyEffect(effect: DeviceEffect): void {
    const device = this.getDevice(effect.address);
    if (device === undefined) {
      return;
    }
    device.applyEffect(effect);
  }
}
