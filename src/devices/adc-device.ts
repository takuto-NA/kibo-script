import type { DeviceAddress } from "../core/device-address";
import type { DeviceEffect, DeviceReadRequest, SimulationDevice } from "../core/device-bus";
import type { ScriptValue } from "../core/value";
import { integerValue, stringValue } from "../core/value";

const DEFAULT_ADC_RESOLUTION_BITS = 10;
const DEFAULT_ADC_MAX_RAW = 1023;

/**
 * Simulated analog input adc#N.
 */
export class AdcDevice implements SimulationDevice {
  private readonly address: DeviceAddress;
  private currentRaw: number;

  public constructor(address: DeviceAddress, initialRaw: number) {
    this.address = address;
    this.currentRaw = initialRaw;
  }

  public setSimulatedRawValue(raw: number): void {
    this.currentRaw = raw;
  }

  public getSimulatedRawValue(): number {
    return this.currentRaw;
  }

  public readProperty(request: DeviceReadRequest): ScriptValue | undefined {
    if (request.property === "raw" || request.property === "") {
      return integerValue(this.currentRaw);
    }
    if (request.property === "info") {
      const text = `kind: adc
id: ${this.address.id}
pin: A${this.address.id}
range: 0..${DEFAULT_ADC_MAX_RAW}
resolution: ${DEFAULT_ADC_RESOLUTION_BITS}`;
      return stringValue(text);
    }
    return undefined;
  }

  public applyEffect(_effect: DeviceEffect): void {
    // adc has no host effects in MVP
  }
}
