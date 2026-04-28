/**
 * 各デバイス種別で利用可能なメソッドの引数数（最小・最大）を定義する。
 */

import type { DeviceKindName } from "../core/device-address";

export type DeviceMethodSignature = {
  minimumParameterCount: number;
  maximumParameterCount: number;
};

export const DEVICE_METHOD_SIGNATURES: Record<
  DeviceKindName,
  Readonly<Record<string, DeviceMethodSignature>>
> = {
  adc: {},
  button: {},
  display: {
    circle: { minimumParameterCount: 3, maximumParameterCount: 3 },
    clear: { minimumParameterCount: 0, maximumParameterCount: 0 },
    line: { minimumParameterCount: 4, maximumParameterCount: 4 },
    pixel: { minimumParameterCount: 2, maximumParameterCount: 2 },
    present: { minimumParameterCount: 0, maximumParameterCount: 0 },
  },
  imu: {},
  led: {
    off: { minimumParameterCount: 0, maximumParameterCount: 0 },
    on: { minimumParameterCount: 0, maximumParameterCount: 0 },
    toggle: { minimumParameterCount: 0, maximumParameterCount: 0 },
  },
  motor: {},
  pwm: {},
  serial: {
    println: { minimumParameterCount: 1, maximumParameterCount: 1 },
  },
  servo: {},
};
