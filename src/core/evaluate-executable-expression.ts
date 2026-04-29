/**
 * ExecutableExpression を DeviceBus / script state 上で評価する。
 */

import type { DeviceBus } from "./device-bus";
import type { CompiledAnimatorDefinition, ExecutableExpression } from "./executable-task";
import type { ScriptValue } from "./value";
import { integerValue, stringValue } from "./value";
import { interpolateAnimatorRampPercent } from "./animator-ramp";

export type EvaluateExecutableExpressionContext = {
  readonly deviceBus: DeviceBus;
  readonly stateValues: Map<string, number | string>;
  /** `every` タスク実行中のみ nominal dt が入る。 */
  readonly taskExecution?: {
    readonly runMode: "every" | "on_event";
    readonly nominalIntervalMilliseconds?: number;
  };
  readonly animatorDefinitionsByName?: ReadonlyMap<string, CompiledAnimatorDefinition>;
  /** step 評価で経過時間を更新する（SimulationRuntime が保持）。 */
  readonly animatorElapsedMillisecondsByName?: Map<string, number>;
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

  if (expression.kind === "dt_interval_ms") {
    return evaluateDtIntervalMilliseconds(context);
  }

  if (expression.kind === "step_animator") {
    return evaluateStepAnimatorExpression(expression.animatorName, context);
  }

  return undefined;
}

function evaluateDtIntervalMilliseconds(context: EvaluateExecutableExpressionContext): ScriptValue | undefined {
  const nominalIntervalMilliseconds = context.taskExecution?.nominalIntervalMilliseconds;
  const runMode = context.taskExecution?.runMode;
  if (runMode !== "every" || nominalIntervalMilliseconds === undefined) {
    return undefined;
  }
  return integerValue(nominalIntervalMilliseconds);
}

function evaluateStepAnimatorExpression(
  animatorName: string,
  context: EvaluateExecutableExpressionContext,
): ScriptValue | undefined {
  const nominalIntervalMilliseconds = context.taskExecution?.nominalIntervalMilliseconds;
  const runMode = context.taskExecution?.runMode;
  if (runMode !== "every" || nominalIntervalMilliseconds === undefined) {
    return undefined;
  }

  const definitions = context.animatorDefinitionsByName;
  const elapsedMap = context.animatorElapsedMillisecondsByName;
  if (definitions === undefined || elapsedMap === undefined) {
    return undefined;
  }

  const definition = definitions.get(animatorName);
  if (definition === undefined) {
    return undefined;
  }

  const previousElapsedMilliseconds = elapsedMap.get(animatorName) ?? 0;
  const nextElapsedMilliseconds = previousElapsedMilliseconds + nominalIntervalMilliseconds;
  elapsedMap.set(animatorName, nextElapsedMilliseconds);

  const rampPercent = interpolateAnimatorRampPercent({
    fromPercent: definition.fromPercent,
    toPercent: definition.toPercent,
    durationMilliseconds: definition.durationMilliseconds,
    elapsedMilliseconds: nextElapsedMilliseconds,
    ease: definition.ease,
  });

  return integerValue(rampPercent);
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
