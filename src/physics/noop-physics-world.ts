/**
 * 責務: Rapier / three.js が無い環境でも Script とデバイス read が動くスタブ物理世界。
 */

import { IMU_ACCEL_MILLI_G_PER_G } from "./physics-simulator-mvp-api";
import type { PhysicsWorld, SimulatedImuSnapshot, SimulatedVehiclePose } from "./physics-world";

const MIN_MOTOR_ID = 0;
const MAX_MOTOR_ID = 1;
const SERVO_ID_FOR_MVP = 0;
const IMU_ID_FOR_MVP = 0;

const DEFAULT_VEHICLE_POSITION_Y = 0.25;
const ONE_G_UPWARD_MILLI_G = 1 * IMU_ACCEL_MILLI_G_PER_G;

export class NoopPhysicsWorld implements PhysicsWorld {
  private readonly motorPowerPercentById: Map<number, number> = new Map();
  private servoAngleDegrees = 0;

  public constructor() {
    this.motorPowerPercentById.set(0, 0);
    this.motorPowerPercentById.set(1, 0);
  }

  public step(_elapsedMilliseconds: number): void {
    // ガード: noop では剛体を進めない。Script と read のみ検証する用途。
  }

  public setMotorPowerPercent(motorId: number, powerPercent: number): void {
    if (motorId < MIN_MOTOR_ID || motorId > MAX_MOTOR_ID) {
      return;
    }
    this.motorPowerPercentById.set(motorId, powerPercent);
  }

  public setServoAngleDegrees(servoId: number, angleDegrees: number): void {
    if (servoId !== SERVO_ID_FOR_MVP) {
      return;
    }
    this.servoAngleDegrees = angleDegrees;
  }

  public getMotorPowerPercent(motorId: number): number {
    return this.motorPowerPercentById.get(motorId) ?? 0;
  }

  public getServoAngleDegrees(servoId: number): number {
    if (servoId !== SERVO_ID_FOR_MVP) {
      return 0;
    }
    return this.servoAngleDegrees;
  }

  public getImuSnapshot(imuId: number): SimulatedImuSnapshot {
    if (imuId !== IMU_ID_FOR_MVP) {
      return this.createFlatTableImuSnapshot();
    }
    return this.createFlatTableImuSnapshot();
  }

  public getVehiclePose(): SimulatedVehiclePose {
    const servoRadians = (this.servoAngleDegrees * Math.PI) / 180;
    return {
      positionX: 0,
      positionY: DEFAULT_VEHICLE_POSITION_Y,
      positionZ: 0,
      quaternionW: 1,
      quaternionX: 0,
      quaternionY: 0,
      quaternionZ: 0,
      servoArmRotationYRadians: servoRadians,
    };
  }

  public dispose(): void {
    // noop
  }

  private createFlatTableImuSnapshot(): SimulatedImuSnapshot {
    return {
      rollMilliDegrees: 0,
      pitchMilliDegrees: 0,
      yawMilliDegrees: 0,
      accelXMilliG: 0,
      accelYMilliG: ONE_G_UPWARD_MILLI_G,
      accelZMilliG: 0,
    };
  }
}
