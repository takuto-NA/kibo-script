/**
 * ExecutableStatement を DeviceBus が適用できる DeviceEffect 列へ変換する。
 * do_method_call の引数は呼び出し側で evaluate 済みの concrete 値として渡す。
 */

import type { DeviceAddress } from "./device-address";
import type { DeviceEffect } from "./device-bus";
import type { ExecutableStatement } from "./executable-task";

export type ConcreteMethodArgument = { kind: "integer"; value: number } | { kind: "string"; value: string };

export function mapDoMethodCallToDeviceEffects(params: {
  deviceAddress: DeviceAddress;
  methodName: string;
  concreteArguments: ConcreteMethodArgument[];
}): DeviceEffect[] {
  const address = params.deviceAddress;
  const methodName = params.methodName;
  const argumentsList = params.concreteArguments;

  if (address.kind === "led") {
    if (methodName === "toggle" && argumentsList.length === 0) {
      return [{ kind: "led.toggle", address }];
    }
    if (methodName === "on" && argumentsList.length === 0) {
      return [{ kind: "led.on", address }];
    }
    if (methodName === "off" && argumentsList.length === 0) {
      return [{ kind: "led.off", address }];
    }
    return [];
  }

  if (address.kind === "serial" && methodName === "println" && argumentsList.length === 1) {
    const firstArgument = argumentsList[0];
    if (firstArgument !== undefined && firstArgument.kind === "string") {
      return [{ kind: "serial.println", address, text: firstArgument.value }];
    }
    return [];
  }

  if (address.kind === "display") {
    if (methodName === "clear" && argumentsList.length === 0) {
      return [{ kind: "display.clear", address }];
    }
    if (methodName === "present" && argumentsList.length === 0) {
      return [{ kind: "display.present", address }];
    }
    if (
      methodName === "pixel" &&
      argumentsList.length === 2 &&
      argumentsList[0]?.kind === "integer" &&
      argumentsList[1]?.kind === "integer"
    ) {
      return [
        {
          kind: "display.pixel",
          address,
          x: argumentsList[0].value,
          y: argumentsList[1].value,
          on: true,
        },
      ];
    }
    if (
      methodName === "line" &&
      argumentsList.length === 4 &&
      argumentsList.every((argument) => argument.kind === "integer")
    ) {
      return [
        {
          kind: "display.line",
          address,
          x0: argumentsList[0].value,
          y0: argumentsList[1].value,
          x1: argumentsList[2].value,
          y1: argumentsList[3].value,
        },
      ];
    }
    if (
      methodName === "circle" &&
      argumentsList.length === 3 &&
      argumentsList.every((argument) => argument.kind === "integer")
    ) {
      return [
        {
          kind: "display.circle",
          address,
          centerX: argumentsList[0].value,
          centerY: argumentsList[1].value,
          radius: argumentsList[2].value,
        },
      ];
    }
  }

  if (address.kind === "pwm" && methodName === "level" && argumentsList.length === 1) {
    const first = argumentsList[0];
    if (first !== undefined && first.kind === "integer") {
      return [{ kind: "pwm.level", address, levelPercent: first.value }];
    }
    return [];
  }

  if (address.kind === "motor" && methodName === "power" && argumentsList.length === 1) {
    const first = argumentsList[0];
    if (first !== undefined && first.kind === "integer") {
      return [{ kind: "motor.power", address, powerPercent: first.value }];
    }
    return [];
  }

  if (address.kind === "servo" && methodName === "angle" && argumentsList.length === 1) {
    const first = argumentsList[0];
    if (first !== undefined && first.kind === "integer") {
      return [{ kind: "servo.angle", address, angleDegrees: first.value }];
    }
    return [];
  }

  return [];
}

/**
 * @deprecated ランタイムでは concrete 引数を解決して mapDoMethodCallToDeviceEffects を使う。
 */
export function mapExecutableStatementToDeviceEffects(statement: ExecutableStatement): DeviceEffect[] {
  if (statement.kind !== "do_method_call") {
    return [];
  }

  const concreteArguments: ConcreteMethodArgument[] = [];
  for (const argument of statement.arguments) {
    if (argument.kind === "integer_literal") {
      concreteArguments.push({ kind: "integer", value: argument.value });
      continue;
    }
    if (argument.kind === "string_literal") {
      concreteArguments.push({ kind: "string", value: argument.value });
      continue;
    }
    return [];
  }

  return mapDoMethodCallToDeviceEffects({
    deviceAddress: statement.deviceAddress,
    methodName: statement.methodName,
    concreteArguments,
  });
}
