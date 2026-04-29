/**
 * 責務: `motor#N` の指令パワーを `PhysicsWorld` へ渡し、read / info を提供する。
 */

import type { DeviceAddress } from "../core/device-address";
import type { DeviceEffect, DeviceReadRequest, SimulationDevice } from "../core/device-bus";
import type { PhysicsWorld } from "../physics/physics-world";
import type { ScriptValue } from "../core/value";
import { integerValue, stringValue } from "../core/value";

const MIN_MOTOR_POWER_PERCENT = -100;
const MAX_MOTOR_POWER_PERCENT = 100;

export class MotorDevice implements SimulationDevice {
  private readonly address: DeviceAddress;
  private readonly physicsWorld: PhysicsWorld;

  public constructor(address: DeviceAddress, physicsWorld: PhysicsWorld) {
    this.address = address;
    this.physicsWorld = physicsWorld;
  }

  public readProperty(request: DeviceReadRequest): ScriptValue | undefined {
    if (request.property === "info") {
      const powerPercent = this.physicsWorld.getMotorPowerPercent(this.address.id);
      const text = `kind: motor
id: ${this.address.id}
power: ${powerPercent}`;
      return stringValue(text);
    }
    if (request.property === "" || request.property === "power") {
      return integerValue(this.physicsWorld.getMotorPowerPercent(this.address.id));
    }
    return undefined;
  }

  public applyEffect(effect: DeviceEffect): void {
    if (effect.address.kind !== this.address.kind || effect.address.id !== this.address.id) {
      return;
    }
    if (effect.kind === "motor.power") {
      const clamped = Math.min(MAX_MOTOR_POWER_PERCENT, Math.max(MIN_MOTOR_POWER_PERCENT, effect.powerPercent));
      this.physicsWorld.setMotorPowerPercent(this.address.id, clamped);
    }
  }
}
