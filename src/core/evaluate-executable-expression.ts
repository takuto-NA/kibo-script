/**
 * ExecutableExpression を DeviceBus / script state 上で評価する。
 */

import type { DeviceBus } from "./device-bus";
import type { ExecutableExpression } from "./executable-task";
import type { ScriptValue } from "./value";
import { integerValue, stringValue } from "./value";

export type EvaluateExecutableExpressionContext = {
  readonly deviceBus: DeviceBus;
  readonly stateValues: Map<string, number | string>;
};

export function evaluateExecutableExpression(
  expression: ExecutableExpression,
  context: EvaluateExecutableExpressionContext,
): ScriptValue | undefined {
  if (expression.kind === "integer_literal") {
    return integerValue(expression.value);
  }

  if (expression.kind === "string_literal") {
    return stringValue(expression.value);
  }

  if (expression.kind === "state_reference") {
    const storedValue = context.stateValues.get(expression.stateName);
    if (storedValue === undefined) {
      return undefined;
    }
    if (typeof storedValue === "number") {
      return integerValue(storedValue);
    }
    return stringValue(storedValue);
  }

  if (expression.kind === "binary_add") {
    const leftValue = evaluateExecutableExpression(expression.left, context);
    const rightValue = evaluateExecutableExpression(expression.right, context);
    if (
      leftValue === undefined ||
      rightValue === undefined ||
      leftValue.tag !== "integer" ||
      rightValue.tag !== "integer"
    ) {
      return undefined;
    }
    return integerValue(leftValue.value + rightValue.value);
  }

  if (expression.kind === "read_property") {
    const scriptValue = context.deviceBus.read({
      address: expression.deviceAddress,
      property: expression.propertyName,
    });
    return scriptValue;
  }

  return undefined;
}

export function scriptValueToPrintableText(value: ScriptValue): string {
  if (value.tag === "integer") {
    return String(value.value);
  }
  if (value.tag === "string") {
    return value.value;
  }
  return "";
}

export function scriptValueToIntegerOrUndefined(value: ScriptValue): number | undefined {
  if (value.tag === "integer") {
    return value.value;
  }
  return undefined;
}
