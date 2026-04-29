/**
 * 責務: `servo#N` の目標角を `PhysicsWorld` へ渡し、read / info を提供する。
 */

import type { DeviceAddress } from "../core/device-address";
import type { DeviceEffect, DeviceReadRequest, SimulationDevice } from "../core/device-bus";
import type { PhysicsWorld } from "../physics/physics-world";
import type { ScriptValue } from "../core/value";
import { integerValue, stringValue } from "../core/value";

const MIN_SERVO_ANGLE_DEGREES = -180;
const MAX_SERVO_ANGLE_DEGREES = 180;

export class ServoDevice implements SimulationDevice {
  private readonly address: DeviceAddress;
  private readonly physicsWorld: PhysicsWorld;

  public constructor(address: DeviceAddress, physicsWorld: PhysicsWorld) {
    this.address = address;
    this.physicsWorld = physicsWorld;
  }

  public readProperty(request: DeviceReadRequest): ScriptValue | undefined {
    if (request.property === "info") {
      const angleDegrees = this.physicsWorld.getServoAngleDegrees(this.address.id);
      const text = `kind: servo
id: ${this.address.id}
angle: ${angleDegrees}`;
      return stringValue(text);
    }
    if (request.property === "" || request.property === "angle") {
      return integerValue(this.physicsWorld.getServoAngleDegrees(this.address.id));
    }
    return undefined;
  }

  public applyEffect(effect: DeviceEffect): void {
    if (effect.address.kind !== this.address.kind || effect.address.id !== this.address.id) {
      return;
    }
    if (effect.kind === "servo.angle") {
      const clamped = Math.min(MAX_SERVO_ANGLE_DEGREES, Math.max(MIN_SERVO_ANGLE_DEGREES, effect.angleDegrees));
      this.physicsWorld.setServoAngleDegrees(this.address.id, clamped);
    }
  }
}
