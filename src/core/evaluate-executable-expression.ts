/**
 * ExecutableExpression を DeviceBus / script state 上で評価する。
 */

import type { DeviceBus } from "./device-bus";
import type { CompiledAnimatorDefinition, ExecutableExpression } from "./executable-task";
import type { AnimatorRuntimeState } from "./animator-runtime-state";
import type { ScriptValue } from "./value";
import { integerValue, stringValue } from "./value";
import { clampPercentToPwmRange, interpolateAnimatorRampPercent } from "./animator-ramp";

export type EvaluateExecutableExpressionContext = {
  readonly deviceBus: DeviceBus;
  readonly stateValues: Map<string, number | string>;
  /** `every` タスク実行中のみ nominal dt が入る。 */
  readonly taskExecution?: {
    readonly runMode: "every" | "on_event";
    readonly nominalIntervalMilliseconds?: number;
  };
  readonly animatorDefinitionsByName?: ReadonlyMap<string, CompiledAnimatorDefinition>;
  /** step 評価で animator 状態を更新する（SimulationRuntime が保持）。 */
  readonly animatorRuntimeStatesByName?: Map<string, AnimatorRuntimeState>;
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
    return evaluateStepAnimatorExpression(expression, context);
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
  expression: ExecutableExpression & { kind: "step_animator" },
  context: EvaluateExecutableExpressionContext,
): ScriptValue | undefined {
  const nominalIntervalMilliseconds = context.taskExecution?.nominalIntervalMilliseconds;
  const runMode = context.taskExecution?.runMode;
  if (runMode !== "every" || nominalIntervalMilliseconds === undefined) {
    return undefined;
  }

  const definitions = context.animatorDefinitionsByName;
  const runtimeStates = context.animatorRuntimeStatesByName;
  if (definitions === undefined || runtimeStates === undefined) {
    return undefined;
  }

  const definition = definitions.get(expression.animatorName);
  if (definition === undefined) {
    return undefined;
  }

  if (definition.rampKind === "from_to") {
    return evaluateFixedEndpointsAnimatorStep({
      definition,
      animatorName: expression.animatorName,
      nominalIntervalMilliseconds,
      runtimeStates,
    });
  }

  return evaluateTargetDrivenAnimatorStep({
    definition,
    expression,
    context,
    nominalIntervalMilliseconds,
    runtimeStates,
  });
}

function evaluateFixedEndpointsAnimatorStep(params: {
  definition: Extract<CompiledAnimatorDefinition, { rampKind: "from_to" }>;
  animatorName: string;
  nominalIntervalMilliseconds: number;
  runtimeStates: Map<string, AnimatorRuntimeState>;
}): ScriptValue | undefined {
  const existingState = params.runtimeStates.get(params.animatorName);
  if (existingState === undefined || existingState.kind !== "fixed_endpoints") {
    return undefined;
  }

  const nextElapsedMilliseconds = existingState.elapsedMilliseconds + params.nominalIntervalMilliseconds;
  existingState.elapsedMilliseconds = nextElapsedMilliseconds;

  const rampPercent = interpolateAnimatorRampPercent({
    fromPercent: params.definition.fromPercent,
    toPercent: params.definition.toPercent,
    durationMilliseconds: params.definition.durationMilliseconds,
    elapsedMilliseconds: nextElapsedMilliseconds,
    ease: params.definition.ease,
  });

  return integerValue(rampPercent);
}

function evaluateTargetDrivenAnimatorStep(params: {
  definition: Extract<CompiledAnimatorDefinition, { rampKind: "over_only" }>;
  expression: ExecutableExpression & { kind: "step_animator" };
  context: EvaluateExecutableExpressionContext;
  nominalIntervalMilliseconds: number;
  runtimeStates: Map<string, AnimatorRuntimeState>;
}): ScriptValue | undefined {
  if (params.expression.targetExpression === undefined) {
    return undefined;
  }

  const targetScriptValue = evaluateExecutableExpression(params.expression.targetExpression, params.context);
  if (targetScriptValue === undefined) {
    return undefined;
  }
  const rawTargetPercent = scriptValueToIntegerOrUndefined(targetScriptValue);
  if (rawTargetPercent === undefined) {
    return undefined;
  }

  const clampedTargetPercent = clampPercentToPwmRange(rawTargetPercent);

  const existingState = params.runtimeStates.get(params.expression.animatorName);
  if (existingState === undefined || existingState.kind !== "target_driven") {
    return undefined;
  }

  const targetChanged =
    existingState.lastTargetPercent === undefined || existingState.lastTargetPercent !== clampedTargetPercent;

  if (targetChanged) {
    existingState.rampFromPercent = existingState.currentOutputPercent;
    existingState.rampToPercent = clampedTargetPercent;
    existingState.elapsedMilliseconds = 0;
    existingState.isRampRunning = existingState.rampFromPercent !== existingState.rampToPercent;
    existingState.lastTargetPercent = clampedTargetPercent;
  }

  if (!existingState.isRampRunning) {
    return integerValue(existingState.currentOutputPercent);
  }

  const nextElapsedMilliseconds = existingState.elapsedMilliseconds + params.nominalIntervalMilliseconds;
  existingState.elapsedMilliseconds = nextElapsedMilliseconds;

  const interpolatedPercent = interpolateAnimatorRampPercent({
    fromPercent: existingState.rampFromPercent,
    toPercent: existingState.rampToPercent,
    durationMilliseconds: params.definition.durationMilliseconds,
    elapsedMilliseconds: nextElapsedMilliseconds,
    ease: params.definition.ease,
  });

  existingState.currentOutputPercent = interpolatedPercent;

  const durationMilliseconds = params.definition.durationMilliseconds;
  if (durationMilliseconds <= 0 || nextElapsedMilliseconds >= durationMilliseconds) {
    existingState.isRampRunning = false;
  }

  return integerValue(existingState.currentOutputPercent);
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
