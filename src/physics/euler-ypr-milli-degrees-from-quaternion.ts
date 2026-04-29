/**
 * 責務: クォータニオンから YXZ 順の yaw / pitch / roll をミリ度（1度=1000）へ変換する。
 */

import * as THREE from "three";

import { IMU_ANGLE_MILLI_DEGREES_PER_DEGREE } from "./physics-simulator-mvp-api";

const DEGREES_PER_RADIAN = 180 / Math.PI;

export function eulerYprMilliDegreesFromQuaternion(params: {
  quaternionW: number;
  quaternionX: number;
  quaternionY: number;
  quaternionZ: number;
}): { yawMilliDegrees: number; pitchMilliDegrees: number; rollMilliDegrees: number } {
  const quaternion = new THREE.Quaternion(
    params.quaternionX,
    params.quaternionY,
    params.quaternionZ,
    params.quaternionW,
  );
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "YXZ");
  const scaleToMilliDegrees = IMU_ANGLE_MILLI_DEGREES_PER_DEGREE * DEGREES_PER_RADIAN;
  return {
    yawMilliDegrees: Math.round(euler.y * scaleToMilliDegrees),
    pitchMilliDegrees: Math.round(euler.x * scaleToMilliDegrees),
    rollMilliDegrees: Math.round(euler.z * scaleToMilliDegrees),
  };
}
