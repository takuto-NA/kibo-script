import type { DeviceAddress } from "../core/device-address";
import type { SimulationDevice } from "../core/device-bus";
import type { PhysicsWorld } from "../physics/physics-world";
import { AdcDevice } from "./adc-device";
import { ButtonDevice } from "./button-device";
import { DisplayDevice } from "./display/display-device";
import { ImuDevice } from "./imu-device";
import { LedDevice } from "./led-device";
import { MotorDevice } from "./motor-device";
import { PwmDevice } from "./pwm-device";
import { SerialDevice } from "./serial-device";
import { ServoDevice } from "./servo-device";

export type DefaultDevices = {
  adc0: AdcDevice;
  serial0: SerialDevice;
  display0: DisplayDevice;
  led0: LedDevice;
  pwm0: PwmDevice;
  button0: ButtonDevice;
  motor0: MotorDevice;
  motor1: MotorDevice;
  servo0: ServoDevice;
  imu0: ImuDevice;
};

/**
 * Creates default board devices: adc#0, serial#0, display#0, led#0, pwm#0, button#0,
 * motor#0–1, servo#0, imu#0。motor / servo / imu は `physicsWorld` と同期する。
 */
export function createDefaultDevices(physicsWorld: PhysicsWorld): DefaultDevices {
  const adc0Address: DeviceAddress = { kind: "adc", id: 0 };
  const serial0Address: DeviceAddress = { kind: "serial", id: 0 };
  const display0Address: DeviceAddress = { kind: "display", id: 0 };
  const led0Address: DeviceAddress = { kind: "led", id: 0 };
  const pwm0Address: DeviceAddress = { kind: "pwm", id: 0 };
  const button0Address: DeviceAddress = { kind: "button", id: 0 };
  const motor0Address: DeviceAddress = { kind: "motor", id: 0 };
  const motor1Address: DeviceAddress = { kind: "motor", id: 1 };
  const servo0Address: DeviceAddress = { kind: "servo", id: 0 };
  const imu0Address: DeviceAddress = { kind: "imu", id: 0 };

  return {
    adc0: new AdcDevice(adc0Address, 512),
    serial0: new SerialDevice(serial0Address),
    display0: new DisplayDevice(display0Address),
    led0: new LedDevice(led0Address),
    pwm0: new PwmDevice(pwm0Address, 0),
    button0: new ButtonDevice(button0Address, false),
    motor0: new MotorDevice(motor0Address, physicsWorld),
    motor1: new MotorDevice(motor1Address, physicsWorld),
    servo0: new ServoDevice(servo0Address, physicsWorld),
    imu0: new ImuDevice(imu0Address, physicsWorld),
  };
}

export function registerDefaultDevices(
  register: (address: DeviceAddress, device: SimulationDevice) => void,
  devices: DefaultDevices,
): void {
  register({ kind: "adc", id: 0 }, devices.adc0);
  register({ kind: "serial", id: 0 }, devices.serial0);
  register({ kind: "display", id: 0 }, devices.display0);
  register({ kind: "led", id: 0 }, devices.led0);
  register({ kind: "pwm", id: 0 }, devices.pwm0);
  register({ kind: "button", id: 0 }, devices.button0);
  register({ kind: "motor", id: 0 }, devices.motor0);
  register({ kind: "motor", id: 1 }, devices.motor1);
  register({ kind: "servo", id: 0 }, devices.servo0);
  register({ kind: "imu", id: 0 }, devices.imu0);
}
