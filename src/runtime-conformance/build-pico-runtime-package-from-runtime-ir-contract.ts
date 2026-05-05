// 責務: simulator export の runtime IR contract JSON（`runtimeIrContractSchemaVersion` + `compiledProgram`）から `PicoRuntimePackage` の canonical JSON テキストを推定生成する。
//
// 注意:
// - MVP 範囲では `everyTasks` がある場合は tick replay、`onEventTasks` のみの場合は dispatch replay、それ以外は既定 tick で replay を組み立てる。
// - `traceObservation.scriptVarNamesToIncludeInTrace` は `--trace-var` 相当の明示が無い場合、`circle_x` が var initializer に存在すれば含める。

import type { CompiledProgram } from "../core/executable-task";
import type { DeviceAddress } from "../core/device-address";
import type { ExecutableExpression, ExecutableStatement } from "../core/executable-task";
import {
  RUNTIME_IR_CONTRACT_SCHEMA_VERSION,
  sortJsonCompatibleValueByKeysDeep,
} from "./serialize-compiled-program-to-runtime-ir-contract-json-text";
import type { RuntimeConformanceReplayStep } from "./build-runtime-conformance-replay-document";
import { serializePicoRuntimePackageToCanonicalJsonText } from "./build-pico-runtime-package";

const DEFAULT_LIVE_TICK_INTERVAL_MILLISECONDS_WHEN_NO_EVERY_TASK = 100;
const DEFAULT_REPLAY_TICK_MILLISECONDS_WHEN_NO_EVERY_OR_ON_EVENT_TASK = 100;

function assertIsRecord(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected JSON object at runtime IR contract root.");
  }
}

function formatDeviceAddress(deviceAddress: DeviceAddress): string {
  return `${deviceAddress.kind}#${deviceAddress.id}`;
}

function assertExpressionIsSupportedByPicoVerticalSliceOrThrow(expression: ExecutableExpression): void {
  if (
    expression.kind === "integer_literal" ||
    expression.kind === "string_literal" ||
    expression.kind === "var_reference" ||
    expression.kind === "const_reference" ||
    expression.kind === "temp_reference" ||
    expression.kind === "dt_interval_ms"
  ) {
    return;
  }
  if (
    expression.kind === "binary_add" ||
    expression.kind === "binary_sub" ||
    expression.kind === "binary_mul" ||
    expression.kind === "binary_div"
  ) {
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(expression.left);
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(expression.right);
    return;
  }
  if (expression.kind === "unary_minus") {
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(expression.operand);
    return;
  }
  if (expression.kind === "comparison") {
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(expression.left);
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(expression.right);
    return;
  }
  if (expression.kind === "read_property") {
    const addressText = formatDeviceAddress(expression.deviceAddress);
    if (addressText === "adc#0" && expression.propertyName === "raw") {
      return;
    }
    throw new Error(`Pico vertical slice does not support read_property: ${addressText}.${expression.propertyName}`);
  }
  throw new Error(`Pico vertical slice does not support expression kind: ${expression.kind}`);
}

function assertStatementIsSupportedByPicoVerticalSliceOrThrow(statement: ExecutableStatement): void {
  if (statement.kind === "do_method_call") {
    const addressText = formatDeviceAddress(statement.deviceAddress);
    const methodText = `${addressText}.${statement.methodName}`;
    const isSupportedLedMethod =
      addressText === "led#0" &&
      (statement.methodName === "toggle" || statement.methodName === "on" || statement.methodName === "off") &&
      statement.arguments.length === 0;
    const isSupportedDisplayMethod =
      addressText === "display#0" &&
      ((statement.methodName === "clear" && statement.arguments.length === 0) ||
        (statement.methodName === "present" && statement.arguments.length === 0) ||
        (statement.methodName === "circle" && statement.arguments.length === 3) ||
        (statement.methodName === "text" && statement.arguments.length === 3));
    const isSupportedSerialMethod =
      addressText === "serial#0" && statement.methodName === "println" && statement.arguments.length === 1;
    const isSupportedPwmMethod =
      addressText === "pwm#0" && statement.methodName === "level" && statement.arguments.length === 1;
    const isSupportedMotorMethod =
      addressText === "motor#0" && statement.methodName === "power" && statement.arguments.length === 1;
    const isSupportedServoMethod =
      addressText === "servo#0" && statement.methodName === "angle" && statement.arguments.length === 1;
    if (
      !isSupportedLedMethod &&
      !isSupportedDisplayMethod &&
      !isSupportedSerialMethod &&
      !isSupportedPwmMethod &&
      !isSupportedMotorMethod &&
      !isSupportedServoMethod
    ) {
      throw new Error(`Pico vertical slice does not support method call: ${methodText}`);
    }
    for (const argument of statement.arguments) {
      assertExpressionIsSupportedByPicoVerticalSliceOrThrow(argument);
    }
    return;
  }
  if (statement.kind === "assign_var") {
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(statement.valueExpression);
    return;
  }
  if (statement.kind === "assign_temp") {
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(statement.valueExpression);
    return;
  }
  if (statement.kind === "wait_milliseconds") {
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(statement.durationMillisecondsExpression);
    return;
  }
  if (statement.kind === "if_comparison") {
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(statement.conditionExpression);
    for (const innerStatement of statement.thenBranchStatements) {
      assertStatementIsSupportedByPicoVerticalSliceOrThrow(innerStatement);
    }
    for (const innerStatement of statement.elseBranchStatements) {
      assertStatementIsSupportedByPicoVerticalSliceOrThrow(innerStatement);
    }
    return;
  }
  if (statement.kind === "match_string") {
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(statement.targetExpression);
    for (const stringCase of statement.stringCases) {
      for (const innerStatement of stringCase.branchStatements) {
        assertStatementIsSupportedByPicoVerticalSliceOrThrow(innerStatement);
      }
    }
    for (const innerStatement of statement.elseBranchStatements) {
      assertStatementIsSupportedByPicoVerticalSliceOrThrow(innerStatement);
    }
    return;
  }
  return throw_unreachable_executable_statement_for_pico_vertical_slice(statement);
}

function throw_unreachable_executable_statement_for_pico_vertical_slice(
  unreachable_statement: never,
): never {
  void unreachable_statement;
  throw new Error(
    "Internal error: assertStatementIsSupportedByPicoVerticalSliceOrThrow is missing a branch for a new ExecutableStatement kind.",
  );
}

function assertCompiledProgramIsSupportedByPicoVerticalSliceOrThrow(compiledProgram: CompiledProgram): void {
  for (const initializer of compiledProgram.varInitializers) {
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(initializer.expression);
  }
  for (const initializer of compiledProgram.constInitializers) {
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(initializer.expression);
  }
  if (compiledProgram.loopTasks.length > 0) {
    for (const task of compiledProgram.loopTasks) {
      for (const statement of task.statements) {
        assertStatementIsSupportedByPicoVerticalSliceOrThrow(statement);
      }
    }
  }
  if (compiledProgram.stateMachines.length > 0) {
    throw new Error("Pico vertical slice does not support state machines yet.");
  }
  if (compiledProgram.animatorDefinitions.length > 0) {
    throw new Error("Pico vertical slice does not support animator definitions yet.");
  }
  for (const task of compiledProgram.everyTasks) {
    for (const statement of task.statements) {
      assertStatementIsSupportedByPicoVerticalSliceOrThrow(statement);
    }
  }
  for (const task of compiledProgram.onEventTasks) {
    if (task.triggerKind !== "device_event") {
      throw new Error(`Pico vertical slice does not support on-event trigger kind: ${task.triggerKind}`);
    }
    for (const statement of task.statements) {
      assertStatementIsSupportedByPicoVerticalSliceOrThrow(statement);
    }
  }
}

export function inferLiveTickIntervalMillisecondsFromCompiledProgram(compiledProgram: CompiledProgram): number {
  if (compiledProgram.everyTasks.length > 0) {
    return compiledProgram.everyTasks[0].intervalMilliseconds;
  }
  return DEFAULT_LIVE_TICK_INTERVAL_MILLISECONDS_WHEN_NO_EVERY_TASK;
}

function inferReplayTickMillisecondsFromLoopTaskWaitOrUndefined(compiledProgram: CompiledProgram): number | undefined {
  for (const loopTask of compiledProgram.loopTasks) {
    for (const statement of loopTask.statements) {
      if (statement.kind !== "wait_milliseconds") {
        continue;
      }
      const durationExpression = statement.durationMillisecondsExpression;
      if (durationExpression.kind !== "integer_literal") {
        continue;
      }
      if (durationExpression.value < 1) {
        continue;
      }
      return durationExpression.value;
    }
  }
  return undefined;
}

export function inferReplayStepsFromCompiledProgramOrThrow(compiledProgram: CompiledProgram): readonly RuntimeConformanceReplayStep[] {
  if (compiledProgram.everyTasks.length > 0) {
    const tickMilliseconds = compiledProgram.everyTasks[0].intervalMilliseconds;
    return [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: tickMilliseconds },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: tickMilliseconds },
      { kind: "collect_trace" },
    ];
  }

  if (compiledProgram.onEventTasks.length > 0) {
    const firstOnEventTask = compiledProgram.onEventTasks[0];
    if (firstOnEventTask.triggerKind !== "device_event") {
      throw new Error(
        `Unsupported onEvent triggerKind for automatic Pico package replay inference: ${firstOnEventTask.triggerKind}`,
      );
    }
    if (firstOnEventTask.deviceAddress === undefined || firstOnEventTask.eventName === undefined) {
      throw new Error("Missing deviceAddress/eventName on first onEventTask for automatic replay inference.");
    }
    return [
      { kind: "collect_trace" },
      {
        kind: "dispatch_device_event",
        deviceKind: firstOnEventTask.deviceAddress.kind,
        deviceId: firstOnEventTask.deviceAddress.id,
        eventName: firstOnEventTask.eventName,
      },
      { kind: "collect_trace" },
      {
        kind: "dispatch_device_event",
        deviceKind: firstOnEventTask.deviceAddress.kind,
        deviceId: firstOnEventTask.deviceAddress.id,
        eventName: firstOnEventTask.eventName,
      },
      { kind: "collect_trace" },
    ];
  }

  const loopTaskWaitTickMilliseconds = inferReplayTickMillisecondsFromLoopTaskWaitOrUndefined(compiledProgram);
  if (loopTaskWaitTickMilliseconds !== undefined) {
    return [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: loopTaskWaitTickMilliseconds },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: loopTaskWaitTickMilliseconds },
      { kind: "collect_trace" },
    ];
  }

  const tickMilliseconds = DEFAULT_REPLAY_TICK_MILLISECONDS_WHEN_NO_EVERY_OR_ON_EVENT_TASK;
  return [
    { kind: "collect_trace" },
    { kind: "tick_ms", elapsedMilliseconds: tickMilliseconds },
    { kind: "collect_trace" },
    { kind: "tick_ms", elapsedMilliseconds: tickMilliseconds },
    { kind: "collect_trace" },
  ];
}

export type PicoRuntimePackageReplayPresetId = "infer" | "basic-3-trace" | "button-toggle-2-press" | "sample-manifest";

const REPLAY_STEPS_TWO_BUTTON_PRESSES: readonly RuntimeConformanceReplayStep[] = [
  { kind: "collect_trace" },
  {
    kind: "dispatch_device_event",
    deviceKind: "button",
    deviceId: 0,
    eventName: "pressed",
  },
  { kind: "collect_trace" },
  {
    kind: "dispatch_device_event",
    deviceKind: "button",
    deviceId: 0,
    eventName: "pressed",
  },
  { kind: "collect_trace" },
];

function resolveReplayStepsForPicoRuntimePackageBuildOrThrow(params: {
  readonly compiledProgram: CompiledProgram;
  readonly replayStepsOverride: readonly RuntimeConformanceReplayStep[] | undefined;
  readonly replayPresetId: PicoRuntimePackageReplayPresetId | undefined;
}): readonly RuntimeConformanceReplayStep[] {
  if (params.replayStepsOverride !== undefined) {
    return params.replayStepsOverride;
  }
  const preset: PicoRuntimePackageReplayPresetId = params.replayPresetId ?? "infer";
  if (preset === "infer") {
    return inferReplayStepsFromCompiledProgramOrThrow(params.compiledProgram);
  }
  if (preset === "basic-3-trace") {
    let tickMilliseconds = DEFAULT_REPLAY_TICK_MILLISECONDS_WHEN_NO_EVERY_OR_ON_EVENT_TASK;
    if (params.compiledProgram.everyTasks.length > 0) {
      tickMilliseconds = params.compiledProgram.everyTasks[0].intervalMilliseconds;
    }
    return [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: tickMilliseconds },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: tickMilliseconds },
      { kind: "collect_trace" },
    ];
  }
  if (preset === "button-toggle-2-press") {
    return REPLAY_STEPS_TWO_BUTTON_PRESSES;
  }
  if (preset === "sample-manifest") {
    // Guard: 現状は `infer` と同じ（将来 samples manifest 専用 replay に差し替え可能）。
    return inferReplayStepsFromCompiledProgramOrThrow(params.compiledProgram);
  }
  throw new Error(`Unsupported replay preset: ${String(preset)}`);
}

export function resolveDefaultScriptVarNamesForTraceFromCompiledProgram(compiledProgram: CompiledProgram): readonly string[] {
  const initializerVarNames = compiledProgram.varInitializers.map((initializer) => initializer.varName);
  const names: string[] = [];
  const includeIfPresent = (varName: string): void => {
    if (initializerVarNames.includes(varName)) {
      names.push(varName);
    }
  };
  includeIfPresent("circle_x");
  includeIfPresent("mode");
  includeIfPresent("branch_toggle");
  includeIfPresent("waited_count");
  return names;
}

export function parseCompiledProgramFromRuntimeIrContractRootOrThrow(root: unknown): CompiledProgram {
  assertIsRecord(root);
  const schemaVersion = root.runtimeIrContractSchemaVersion;
  if (schemaVersion !== RUNTIME_IR_CONTRACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported runtimeIrContractSchemaVersion: ${String(schemaVersion)}`);
  }
  const compiledProgramUnknown = root.compiledProgram;
  assertIsRecord(compiledProgramUnknown);
  return sortJsonCompatibleValueByKeysDeep(compiledProgramUnknown) as unknown as CompiledProgram;
}

export function buildPicoRuntimePackageCanonicalJsonTextFromRuntimeIrContractJsonTextOrThrow(params: {
  readonly runtimeIrContractJsonText: string;
  readonly scriptVarNamesToIncludeInTraceOverride: readonly string[] | undefined;
  readonly liveTickIntervalMillisecondsOverride?: number | undefined;
  readonly replayStepsOverride?: readonly RuntimeConformanceReplayStep[] | undefined;
  readonly replayPresetId?: PicoRuntimePackageReplayPresetId | undefined;
}): string {
  const parsedRoot: unknown = JSON.parse(params.runtimeIrContractJsonText);
  const compiledProgram = parseCompiledProgramFromRuntimeIrContractRootOrThrow(parsedRoot);
  assertCompiledProgramIsSupportedByPicoVerticalSliceOrThrow(compiledProgram);
  const replaySteps = resolveReplayStepsForPicoRuntimePackageBuildOrThrow({
    compiledProgram,
    replayStepsOverride: params.replayStepsOverride,
    replayPresetId: params.replayPresetId,
  });
  let liveTickIntervalMilliseconds = inferLiveTickIntervalMillisecondsFromCompiledProgram(compiledProgram);
  if (params.liveTickIntervalMillisecondsOverride !== undefined) {
    if (params.liveTickIntervalMillisecondsOverride < 1) {
      throw new Error("liveTickIntervalMillisecondsOverride must be >= 1.");
    }
    liveTickIntervalMilliseconds = params.liveTickIntervalMillisecondsOverride;
  }
  const scriptVarNamesToIncludeInTrace =
    params.scriptVarNamesToIncludeInTraceOverride ?? resolveDefaultScriptVarNamesForTraceFromCompiledProgram(compiledProgram);

  return serializePicoRuntimePackageToCanonicalJsonText({
    compiledProgram,
    replaySteps,
    scriptVarNamesToIncludeInTrace,
    liveTickIntervalMilliseconds,
  });
}

export function buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow(params: {
  readonly compiledProgram: CompiledProgram;
  readonly scriptVarNamesToIncludeInTraceOverride: readonly string[] | undefined;
  readonly liveTickIntervalMillisecondsOverride?: number | undefined;
  readonly replayStepsOverride?: readonly RuntimeConformanceReplayStep[] | undefined;
  readonly replayPresetId?: PicoRuntimePackageReplayPresetId | undefined;
}): string {
  assertCompiledProgramIsSupportedByPicoVerticalSliceOrThrow(params.compiledProgram);
  const replaySteps = resolveReplayStepsForPicoRuntimePackageBuildOrThrow({
    compiledProgram: params.compiledProgram,
    replayStepsOverride: params.replayStepsOverride,
    replayPresetId: params.replayPresetId,
  });
  let liveTickIntervalMilliseconds = inferLiveTickIntervalMillisecondsFromCompiledProgram(params.compiledProgram);
  if (params.liveTickIntervalMillisecondsOverride !== undefined) {
    if (params.liveTickIntervalMillisecondsOverride < 1) {
      throw new Error("liveTickIntervalMillisecondsOverride must be >= 1.");
    }
    liveTickIntervalMilliseconds = params.liveTickIntervalMillisecondsOverride;
  }
  const scriptVarNamesToIncludeInTrace =
    params.scriptVarNamesToIncludeInTraceOverride ?? resolveDefaultScriptVarNamesForTraceFromCompiledProgram(params.compiledProgram);

  return serializePicoRuntimePackageToCanonicalJsonText({
    compiledProgram: params.compiledProgram,
    replaySteps,
    scriptVarNamesToIncludeInTrace,
    liveTickIntervalMilliseconds,
  });
}

export function extractReplayInputsFromPicoRuntimePackageUnknownJsonOrThrow(packageRoot: unknown): {
  readonly compiledProgram: CompiledProgram;
  readonly replaySteps: readonly RuntimeConformanceReplayStep[];
  readonly scriptVarNamesToIncludeInTrace: readonly string[];
} {
  assertIsRecord(packageRoot);
  const runtimeIrContractUnknown = packageRoot.runtimeIrContract;
  const compiledProgram = parseCompiledProgramFromRuntimeIrContractRootOrThrow(runtimeIrContractUnknown);

  const replayUnknown = packageRoot.replay;
  if (replayUnknown === null || typeof replayUnknown !== "object" || Array.isArray(replayUnknown)) {
    throw new Error("Missing replay object on PicoRuntimePackage JSON.");
  }
  const replayRecord = replayUnknown as Record<string, unknown>;
  const stepsUnknown = replayRecord.steps;
  if (!Array.isArray(stepsUnknown)) {
    throw new Error("Missing replay.steps array on PicoRuntimePackage JSON.");
  }
  const replaySteps = stepsUnknown as unknown as readonly RuntimeConformanceReplayStep[];

  const traceObservationUnknown = packageRoot.traceObservation;
  if (
    traceObservationUnknown === null ||
    typeof traceObservationUnknown !== "object" ||
    Array.isArray(traceObservationUnknown)
  ) {
    throw new Error("Missing traceObservation object on PicoRuntimePackage JSON.");
  }
  const traceObservationRecord = traceObservationUnknown as Record<string, unknown>;
  const scriptVarNamesUnknown = traceObservationRecord.scriptVarNamesToIncludeInTrace;
  if (!Array.isArray(scriptVarNamesUnknown)) {
    throw new Error("Missing traceObservation.scriptVarNamesToIncludeInTrace array on PicoRuntimePackage JSON.");
  }
  const scriptVarNamesToIncludeInTrace = scriptVarNamesUnknown.map((name) => {
    if (typeof name !== "string") {
      throw new Error("traceObservation.scriptVarNamesToIncludeInTrace must be string[].");
    }
    return name;
  });

  return {
    compiledProgram,
    replaySteps,
    scriptVarNamesToIncludeInTrace,
  };
}
