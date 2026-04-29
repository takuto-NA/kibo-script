/**
 * 責務: `imu#N` の観測値を `PhysicsWorld` のシミュレーション結果から read する。
 */

import type { DeviceAddress } from "../core/device-address";
import type { DeviceEffect, DeviceReadRequest, SimulationDevice } from "../core/device-bus";
import type { PhysicsWorld } from "../physics/physics-world";
import type { ScriptValue } from "../core/value";
import { integerValue, stringValue } from "../core/value";

export class ImuDevice implements SimulationDevice {
  private readonly address: DeviceAddress;
  private readonly physicsWorld: PhysicsWorld;

  public constructor(address: DeviceAddress, physicsWorld: PhysicsWorld) {
    this.address = address;
    this.physicsWorld = physicsWorld;
  }

  public readProperty(request: DeviceReadRequest): ScriptValue | undefined {
    if (request.property === "info") {
      const snapshot = this.physicsWorld.getImuSnapshot(this.address.id);
      const text = `kind: imu
id: ${this.address.id}
roll_mdeg: ${snapshot.rollMilliDegrees}
pitch_mdeg: ${snapshot.pitchMilliDegrees}
yaw_mdeg: ${snapshot.yawMilliDegrees}
accel_x_mg: ${snapshot.accelXMilliG}
accel_y_mg: ${snapshot.accelYMilliG}
accel_z_mg: ${snapshot.accelZMilliG}`;
      return stringValue(text);
    }

    const snapshot = this.physicsWorld.getImuSnapshot(this.address.id);
    if (request.property === "roll") {
      return integerValue(snapshot.rollMilliDegrees);
    }
    if (request.property === "pitch") {
      return integerValue(snapshot.pitchMilliDegrees);
    }
    if (request.property === "yaw") {
      return integerValue(snapshot.yawMilliDegrees);
    }
    if (request.property === "accel_x") {
      return integerValue(snapshot.accelXMilliG);
    }
    if (request.property === "accel_y") {
      return integerValue(snapshot.accelYMilliG);
    }
    if (request.property === "accel_z") {
      return integerValue(snapshot.accelZMilliG);
    }
    return undefined;
  }

  public applyEffect(_effect: DeviceEffect): void {
    // IMU は観測専用。Effect は受け付けない。
  }
}
