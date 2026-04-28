import type { DeviceAddress } from "../core/device-address";
import type { DeviceEffect, DeviceReadRequest, SimulationDevice } from "../core/device-bus";
import type { ScriptValue } from "../core/value";
import { booleanValue, stringValue } from "../core/value";

/**
 * Simulated single LED (on/off) at led#N.
 */
export class LedDevice implements SimulationDevice {
  private readonly address: DeviceAddress;
  private isLightOn: boolean;

  public constructor(address: DeviceAddress) {
    this.address = address;
    this.isLightOn = false;
  }

  public isOn(): boolean {
    return this.isLightOn;
  }

  public readProperty(request: DeviceReadRequest): ScriptValue | undefined {
    if (request.property === "info") {
      const text = `kind: led
id: ${this.address.id}
on: ${this.isLightOn}`;
      return stringValue(text);
    }
    if (request.property === "on" || request.property === "") {
      return booleanValue(this.isLightOn);
    }
    return undefined;
  }

  public applyEffect(effect: DeviceEffect): void {
    if (effect.address.kind !== this.address.kind || effect.address.id !== this.address.id) {
      return;
    }
    if (effect.kind === "led.on") {
      this.isLightOn = true;
      return;
    }
    if (effect.kind === "led.off") {
      this.isLightOn = false;
      return;
    }
    if (effect.kind === "led.toggle") {
      this.isLightOn = !this.isLightOn;
    }
  }
}
