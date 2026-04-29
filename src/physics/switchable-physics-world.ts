/**
 * 責務: UI を即時表示するために Noop で開始し、Rapier 初期化後に実体を差し替える物理世界プロキシ。
 */

import type { PhysicsWorld, SimulatedImuSnapshot, SimulatedVehiclePose } from "./physics-world";

export class SwitchablePhysicsWorld implements PhysicsWorld {
  private delegate: PhysicsWorld;

  public constructor(initialDelegate: PhysicsWorld) {
    this.delegate = initialDelegate;
  }

  public replaceDelegate(nextDelegate: PhysicsWorld): void {
    const previousDelegate = this.delegate;
    nextDelegate.setMotorPowerPercent(0, previousDelegate.getMotorPowerPercent(0));
    nextDelegate.setMotorPowerPercent(1, previousDelegate.getMotorPowerPercent(1));
    nextDelegate.setServoAngleDegrees(0, previousDelegate.getServoAngleDegrees(0));
    this.delegate = nextDelegate;
    previousDelegate.dispose();
  }

  public step(elapsedMilliseconds: number): void {
    this.delegate.step(elapsedMilliseconds);
  }

  public setMotorPowerPercent(motorId: number, powerPercent: number): void {
    this.delegate.setMotorPowerPercent(motorId, powerPercent);
  }

  public setServoAngleDegrees(servoId: number, angleDegrees: number): void {
    this.delegate.setServoAngleDegrees(servoId, angleDegrees);
  }

  public getMotorPowerPercent(motorId: number): number {
    return this.delegate.getMotorPowerPercent(motorId);
  }

  public getServoAngleDegrees(servoId: number): number {
    return this.delegate.getServoAngleDegrees(servoId);
  }

  public getImuSnapshot(imuId: number): SimulatedImuSnapshot {
    return this.delegate.getImuSnapshot(imuId);
  }

  public getVehiclePose(): SimulatedVehiclePose {
    return this.delegate.getVehiclePose();
  }

  public dispose(): void {
    this.delegate.dispose();
  }
}
