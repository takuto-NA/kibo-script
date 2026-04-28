/**
 * Parse device references like adc#0, display#0, serial#0.
 */

export type DeviceKindName =
  | "adc"
  | "serial"
  | "display"
  | "led"
  | "pwm"
  | "button"
  | "imu"
  | "motor"
  | "servo";

export type DeviceAddress = {
  kind: DeviceKindName;
  id: number;
};

const DEVICE_KIND_PATTERN =
  /^(adc|serial|display|led|pwm|button|imu|motor|servo)#(\d+)$/;

export type ParseDeviceAddressResult =
  | { ok: true; address: DeviceAddress }
  | { ok: false; reason: "invalid_format" };

export function parseDeviceAddress(text: string): ParseDeviceAddressResult {
  const trimmed = text.trim();
  const match = DEVICE_KIND_PATTERN.exec(trimmed);
  if (match === null) {
    return { ok: false, reason: "invalid_format" };
  }
  const kind = match[1] as DeviceKindName;
  const id = Number.parseInt(match[2] ?? "0", 10);
  return { ok: true, address: { kind, id } };
}

export function formatDeviceAddress(address: DeviceAddress): string {
  return `${address.kind}#${address.id}`;
}
