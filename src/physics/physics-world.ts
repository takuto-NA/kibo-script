/**
 * 責務: Script runtime / 仮想デバイスから見える物理世界の抽象。three.js や Rapier への依存は実装側に閉じる。
 */

/** 車体メッシュとIMU表示用の姿勢（ワールド座標、Y 上向き想定）。 */
export type SimulatedVehiclePose = {
  positionX: number;
  positionY: number;
  positionZ: number;
  quaternionW: number;
  quaternionX: number;
  quaternionY: number;
  quaternionZ: number;
  /** サーボで動かすパーツの回転（ラジアン、Y 軸周り）。 */
  servoArmRotationYRadians: number;
};

export type SimulatedImuSnapshot = {
  rollMilliDegrees: number;
  pitchMilliDegrees: number;
  yawMilliDegrees: number;
  accelXMilliG: number;
  accelYMilliG: number;
  accelZMilliG: number;
};

export interface PhysicsWorld {
  /** 経過シミュレーション時間に応じて物理状態を進める。 */
  step(elapsedMilliseconds: number): void;

  setMotorPowerPercent(motorId: number, powerPercent: number): void;

  setServoAngleDegrees(servoId: number, angleDegrees: number): void;

  getMotorPowerPercent(motorId: number): number;

  getServoAngleDegrees(servoId: number): number;

  getImuSnapshot(imuId: number): SimulatedImuSnapshot;

  getVehiclePose(): SimulatedVehiclePose;

  /** WASM や WebGL を解放する。 */
  dispose(): void;
}
