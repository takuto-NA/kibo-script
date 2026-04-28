/**
 * ExecutableStatement を DeviceBus が適用できる DeviceEffect 列へ変換する。
 */

import type { ExecutableStatement } from "./executable-task";
import type { DeviceEffect } from "./device-bus";

export function mapExecutableStatementToDeviceEffects(statement: ExecutableStatement): DeviceEffect[] {
  if (statement.kind !== "do_method_call") {
    return [];
  }

  const address = statement.deviceAddress;
  const methodName = statement.methodName;
  const argumentsList = statement.arguments;

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
    if (firstArgument.kind === "string") {
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

  return [];
}
