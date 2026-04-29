/**
 * ExecutableExpression を DeviceBus / script state 上で評価する。
 */

import type { DeviceBus } from "./device-bus";
import type { CompiledAnimatorDefinition, ExecutableExpression, ExecutableMatchPattern } from "./executable-task";
import type { AnimatorRuntimeState } from "./animator-runtime-state";
import type { ScriptValue } from "./value";
import { integerValue, stringValue } from "./value";
import { clampPercentToPwmRange, interpolateAnimatorRampPercent } from "./animator-ramp";

export type EvaluateExecutableExpressionContext = {
  readonly deviceBus: DeviceBus;
  readonly stateValues: Map<string, number | string>;
  /** プログラム定数（読み取り専用）。 */
  readonly constValues?: ReadonlyMap<string, number | string>;
  /** 現在の task の `temp`（SimulationRuntime が TaskRecord から渡す）。 */
  readonly tempValues?: Map<string, number | string>;
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

  if (expression.kind === "const_reference") {
    const constValues = context.constValues;
    if (constValues === undefined) {
      return undefined;
    }
    const storedValue = constValues.get(expression.constName);
    if (storedValue === undefined) {
      return undefined;
    }
    if (typeof storedValue === "number") {
      return integerValue(storedValue);
    }
    return stringValue(storedValue);
  }

  if (expression.kind === "temp_reference") {
    const tempValues = context.tempValues;
    if (tempValues === undefined) {
      return undefined;
    }
    const storedValue = tempValues.get(expression.tempName);
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

  if (expression.kind === "binary_sub") {
    return evaluateIntegerBinaryOp(expression.left, expression.right, context, (a, b) => a - b);
  }

  if (expression.kind === "binary_mul") {
    return evaluateIntegerBinaryOp(expression.left, expression.right, context, (a, b) => a * b);
  }

  if (expression.kind === "binary_div") {
    return evaluateIntegerBinaryOp(expression.left, expression.right, context, (a, b) => {
      if (b === 0) {
        return undefined;
      }
      return Math.trunc(a / b);
    });
  }

  if (expression.kind === "unary_minus") {
    const operand = evaluateExecutableExpression(expression.operand, context);
    if (operand === undefined || operand.tag !== "integer") {
      return undefined;
    }
    return integerValue(-operand.value);
  }

  if (expression.kind === "comparison") {
    return evaluateComparisonExpression(expression, context);
  }

  if (expression.kind === "match_numeric_expression") {
    return evaluateMatchNumericExpression(expression, context);
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

const INTEGER_TRUTHY = 1;
const INTEGER_FALSY = 0;

function evaluateIntegerBinaryOp(
  left: ExecutableExpression,
  right: ExecutableExpression,
  context: EvaluateExecutableExpressionContext,
  combine: (left: number, right: number) => number | undefined,
): ScriptValue | undefined {
  const leftValue = evaluateExecutableExpression(left, context);
  const rightValue = evaluateExecutableExpression(right, context);
  if (
    leftValue === undefined ||
    rightValue === undefined ||
    leftValue.tag !== "integer" ||
    rightValue.tag !== "integer"
  ) {
    return undefined;
  }
  const next = combine(leftValue.value, rightValue.value);
  if (next === undefined) {
    return undefined;
  }
  return integerValue(next);
}

function evaluateComparisonExpression(
  expression: ExecutableExpression & { kind: "comparison" },
  context: EvaluateExecutableExpressionContext,
): ScriptValue | undefined {
  const leftValue = evaluateExecutableExpression(expression.left, context);
  const rightValue = evaluateExecutableExpression(expression.right, context);
  if (leftValue === undefined || rightValue === undefined) {
    return undefined;
  }
  if (leftValue.tag === "integer" && rightValue.tag === "integer") {
    return booleanToIntegerValue(compareIntegers(leftValue.value, rightValue.value, expression.operator));
  }
  if (leftValue.tag === "string" && rightValue.tag === "string") {
    return booleanToIntegerValue(compareStrings(leftValue.value, rightValue.value, expression.operator));
  }
  return undefined;
}

function compareIntegers(
  left: number,
  right: number,
  operator: "==" | "!=" | "<" | "<=" | ">" | ">=",
): boolean {
  if (operator === "==") {
    return left === right;
  }
  if (operator === "!=") {
    return left !== right;
  }
  if (operator === "<") {
    return left < right;
  }
  if (operator === "<=") {
    return left <= right;
  }
  if (operator === ">") {
    return left > right;
  }
  return left >= right;
}

function compareStrings(
  left: string,
  right: string,
  operator: "==" | "!=" | "<" | "<=" | ">" | ">=",
): boolean {
  if (operator === "==" || operator === "!=") {
    const eq = left === right;
    return operator === "==" ? eq : !eq;
  }
  return false;
}

function booleanToIntegerValue(testResult: boolean): ScriptValue {
  return integerValue(testResult ? INTEGER_TRUTHY : INTEGER_FALSY);
}

function evaluateMatchNumericExpression(
  expression: ExecutableExpression & { kind: "match_numeric_expression" },
  context: EvaluateExecutableExpressionContext,
): ScriptValue | undefined {
  const scrutineeValue = evaluateExecutableExpression(expression.scrutinee, context);
  if (scrutineeValue === undefined) {
    return undefined;
  }

  if (scrutineeValue.tag === "string") {
    const matchedText = scrutineeValue.value;
    for (const arm of expression.arms) {
      if (arm.pattern.kind !== "equality_pattern") {
        continue;
      }
      const compareValue = evaluateExecutableExpression(arm.pattern.compareExpression, context);
      if (compareValue !== undefined && compareValue.tag === "string" && compareValue.value === matchedText) {
        return evaluateExecutableExpression(arm.resultExpression, context);
      }
    }
    if (expression.elseResultExpression !== undefined) {
      return evaluateExecutableExpression(expression.elseResultExpression, context);
    }
    return undefined;
  }

  if (scrutineeValue.tag !== "integer") {
    return undefined;
  }
  const scrutineeInteger = scrutineeValue.value;

  for (const arm of expression.arms) {
    if (arm.pattern.kind === "equality_pattern") {
      const compareValue = evaluateExecutableExpression(arm.pattern.compareExpression, context);
      if (compareValue === undefined || compareValue.tag !== "integer") {
        continue;
      }
      if (compareValue.value === scrutineeInteger) {
        return evaluateExecutableExpression(arm.resultExpression, context);
      }
      continue;
    }

    const inRange = evaluateRangePatternMatchInteger({
      pattern: arm.pattern,
      scrutinee: scrutineeInteger,
      context,
    });
    if (inRange) {
      return evaluateExecutableExpression(arm.resultExpression, context);
    }
  }

  if (expression.elseResultExpression !== undefined) {
    return evaluateExecutableExpression(expression.elseResultExpression, context);
  }
  return undefined;
}

function evaluateRangePatternMatchInteger(params: {
  pattern: ExecutableMatchPattern;
  scrutinee: number;
  context: EvaluateExecutableExpressionContext;
}): boolean {
  const pattern = params.pattern;
  if (pattern.kind !== "range_pattern") {
    return false;
  }

  let startInclusive: number | undefined;
  if (pattern.startInclusive !== undefined) {
    const startValue = evaluateExecutableExpression(pattern.startInclusive, params.context);
    if (startValue === undefined || startValue.tag !== "integer") {
      return false;
    }
    startInclusive = startValue.value;
  }

  let endExclusive: number | undefined;
  if (pattern.endExclusive !== undefined) {
    const endValue = evaluateExecutableExpression(pattern.endExclusive, params.context);
    if (endValue === undefined || endValue.tag !== "integer") {
      return false;
    }
    endExclusive = endValue.value;
  }

  const scr = params.scrutinee;
  if (startInclusive !== undefined && scr < startInclusive) {
    return false;
  }
  if (endExclusive !== undefined && scr >= endExclusive) {
    return false;
  }
  return true;
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
