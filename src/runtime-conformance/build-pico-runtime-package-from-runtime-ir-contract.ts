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
        (statement.methodName === "circle" && statement.arguments.length === 3));
    if (!isSupportedLedMethod && !isSupportedDisplayMethod) {
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
  throw new Error(`Pico vertical slice does not support statement kind: ${statement.kind}`);
}

function assertCompiledProgramIsSupportedByPicoVerticalSliceOrThrow(compiledProgram: CompiledProgram): void {
  for (const initializer of compiledProgram.varInitializers) {
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(initializer.expression);
  }
  for (const initializer of compiledProgram.constInitializers) {
    assertExpressionIsSupportedByPicoVerticalSliceOrThrow(initializer.expression);
  }
  if (compiledProgram.loopTasks.length > 0) {
    throw new Error("Pico vertical slice does not support loop tasks yet.");
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

  const tickMilliseconds = DEFAULT_REPLAY_TICK_MILLISECONDS_WHEN_NO_EVERY_OR_ON_EVENT_TASK;
  return [
    { kind: "collect_trace" },
    { kind: "tick_ms", elapsedMilliseconds: tickMilliseconds },
    { kind: "collect_trace" },
    { kind: "tick_ms", elapsedMilliseconds: tickMilliseconds },
    { kind: "collect_trace" },
  ];
}

export function resolveDefaultScriptVarNamesForTraceFromCompiledProgram(compiledProgram: CompiledProgram): readonly string[] {
  const initializerVarNames = compiledProgram.varInitializers.map((initializer) => initializer.varName);
  if (initializerVarNames.includes("circle_x")) {
    return ["circle_x"];
  }
  return [];
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
}): string {
  const parsedRoot: unknown = JSON.parse(params.runtimeIrContractJsonText);
  const compiledProgram = parseCompiledProgramFromRuntimeIrContractRootOrThrow(parsedRoot);
  assertCompiledProgramIsSupportedByPicoVerticalSliceOrThrow(compiledProgram);
  const replaySteps = inferReplayStepsFromCompiledProgramOrThrow(compiledProgram);
  const liveTickIntervalMilliseconds = inferLiveTickIntervalMillisecondsFromCompiledProgram(compiledProgram);
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
}): string {
  assertCompiledProgramIsSupportedByPicoVerticalSliceOrThrow(params.compiledProgram);
  const replaySteps = inferReplayStepsFromCompiledProgramOrThrow(params.compiledProgram);
  const liveTickIntervalMilliseconds = inferLiveTickIntervalMillisecondsFromCompiledProgram(params.compiledProgram);
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
