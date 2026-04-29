import type { DeviceAddress } from "../core/device-address";
import type { DeviceEffect, DeviceReadRequest, SimulationDevice } from "../core/device-bus";
import type { ScriptValue } from "../core/value";
import { integerValue, stringValue } from "../core/value";

const MIN_PWM_PERCENT = 0;
const MAX_PWM_PERCENT = 100;

/**
 * Simulated PWM output pwm#N（duty をパーセントで保持）。
 */
export class PwmDevice implements SimulationDevice {
  private readonly address: DeviceAddress;
  private levelPercent: number;

  public constructor(address: DeviceAddress, initialLevelPercent: number) {
    this.address = address;
    this.levelPercent = initialLevelPercent;
  }

  public getLevelPercent(): number {
    return this.levelPercent;
  }

  public readProperty(request: DeviceReadRequest): ScriptValue | undefined {
    if (request.property === "info") {
      const text = `kind: pwm
id: ${this.address.id}
level: ${this.levelPercent}%`;
      return stringValue(text);
    }
    if (request.property === "level" || request.property === "") {
      return integerValue(this.levelPercent);
    }
    return undefined;
  }

  public applyEffect(effect: DeviceEffect): void {
    if (effect.address.kind !== this.address.kind || effect.address.id !== this.address.id) {
      return;
    }
    if (effect.kind === "pwm.level") {
      const clamped = Math.min(MAX_PWM_PERCENT, Math.max(MIN_PWM_PERCENT, effect.levelPercent));
      this.levelPercent = clamped;
    }
  }
}
