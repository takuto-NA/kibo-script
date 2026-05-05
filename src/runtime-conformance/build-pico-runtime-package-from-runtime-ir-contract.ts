// 責務: simulator export の runtime IR contract JSON（`runtimeIrContractSchemaVersion` + `compiledProgram`）から `PicoRuntimePackage` の canonical JSON テキストを推定生成する。
//
// 注意:
// - `everyTasks` がある場合は tick replay、先頭 `onEventTasks` が `device_event` の場合は dispatch replay、それ以外は state machine tick（あれば）→ `loop` の `wait` 推定 → 既定 tick の順で replay を組み立てる。
// - `traceObservation.scriptVarNamesToIncludeInTrace` は `--trace-var` 相当の明示が無い場合、`circle_x` が var initializer に存在すれば含める。

import type { CompiledProgram, ExecutableExpression, ExecutableStatement } from "../core/executable-task";
import type { DeviceAddress } from "../core/device-address";
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
    expression.kind === "dt_interval_ms" ||
    expression.kind === "state_path_elapsed_reference"
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

function assertPicoSupportedStateMachineTransitionConditionExpressionOrThrow(expression: ExecutableExpression): void {
  if (
    expression.kind === "integer_literal" ||
    expression.kind === "string_literal" ||
    expression.kind === "var_reference" ||
    expression.kind === "const_reference" ||
    expression.kind === "state_path_elapsed_reference"
  ) {
    return;
  }
  if (
    expression.kind === "binary_add" ||
    expression.kind === "binary_sub" ||
    expression.kind === "binary_mul" ||
    expression.kind === "binary_div"
  ) {
    assertPicoSupportedStateMachineTransitionConditionExpressionOrThrow(expression.left);
    assertPicoSupportedStateMachineTransitionConditionExpressionOrThrow(expression.right);
    return;
  }
  if (expression.kind === "unary_minus") {
    assertPicoSupportedStateMachineTransitionConditionExpressionOrThrow(expression.operand);
    return;
  }
  if (expression.kind === "comparison") {
    assertPicoSupportedStateMachineTransitionConditionExpressionOrThrow(expression.left);
    assertPicoSupportedStateMachineTransitionConditionExpressionOrThrow(expression.right);
    return;
  }
  throw new Error(
    `Pico vertical slice does not support this expression kind in state machine transition conditions: ${expression.kind}`,
  );
}

function buildStateMachineNodePathsByMachineName(compiledProgram: CompiledProgram): ReadonlyMap<string, ReadonlySet<string>> {
  const node_paths_by_machine_name = new Map<string, ReadonlySet<string>>();
  for (const state_machine of compiledProgram.stateMachines) {
    const paths = new Set<string>();
    for (const node of state_machine.nodes) {
      paths.add(node.path);
    }
    node_paths_by_machine_name.set(state_machine.machineName, paths);
  }
  return node_paths_by_machine_name;
}

function resolveMachineNameFromStateMembershipPathOrThrow(state_membership_path: string): string {
  const dot_index = state_membership_path.indexOf(".");
  if (dot_index === -1) {
    return state_membership_path;
  }
  return state_membership_path.slice(0, dot_index);
}

function throwIfStateMembershipPathDoesNotReferenceKnownStatePrefixOrThrow(params: {
  readonly membership_path: string;
  readonly node_paths_by_machine_name: ReadonlyMap<string, ReadonlySet<string>>;
  readonly human_readable_context: string;
}): void {
  const machine_name = resolveMachineNameFromStateMembershipPathOrThrow(params.membership_path);
  const node_paths = params.node_paths_by_machine_name.get(machine_name);
  if (node_paths === undefined) {
    throw new Error(
      `Pico vertical slice: ${params.human_readable_context} has stateMembershipPath "${params.membership_path}" but state machine "${machine_name}" does not exist.`,
    );
  }
  for (const node_path of node_paths) {
    if (node_path === params.membership_path) {
      return;
    }
    const prefix_with_dot = `${params.membership_path}.`;
    if (node_path.startsWith(prefix_with_dot)) {
      return;
    }
  }
  throw new Error(
    `Pico vertical slice: ${params.human_readable_context} has stateMembershipPath "${params.membership_path}" but no state node uses that prefix in machine "${machine_name}".`,
  );
}

function throwIfStateMembershipPathIsNotExactNodePathOrThrow(params: {
  readonly membership_path: string;
  readonly node_paths_by_machine_name: ReadonlyMap<string, ReadonlySet<string>>;
  readonly human_readable_context: string;
}): void {
  const machine_name = resolveMachineNameFromStateMembershipPathOrThrow(params.membership_path);
  const node_paths = params.node_paths_by_machine_name.get(machine_name);
  if (node_paths === undefined) {
    throw new Error(
      `Pico vertical slice: ${params.human_readable_context} has stateMembershipPath "${params.membership_path}" but state machine "${machine_name}" does not exist.`,
    );
  }
  if (!node_paths.has(params.membership_path)) {
    throw new Error(
      `Pico vertical slice: ${params.human_readable_context} requires stateMembershipPath "${params.membership_path}" to match an exact compiled state node path.`,
    );
  }
}

function throwIfCompiledProgramDeclaresStateMembershipWithoutStateMachinesOrThrow(compiledProgram: CompiledProgram): void {
  for (const task of compiledProgram.everyTasks) {
    if (task.stateMembershipPath !== undefined) {
      throw new Error(
        `Pico vertical slice: everyTask "${task.taskName}" declares stateMembershipPath but compiledProgram.stateMachines is empty.`,
      );
    }
  }
  for (const task of compiledProgram.loopTasks) {
    if (task.stateMembershipPath !== undefined) {
      throw new Error(
        `Pico vertical slice: loopTask "${task.taskName}" declares stateMembershipPath but compiledProgram.stateMachines is empty.`,
      );
    }
  }
  for (const task of compiledProgram.onEventTasks) {
    if (task.stateMembershipPath !== undefined) {
      throw new Error(
        `Pico vertical slice: onEventTask "${task.taskName}" declares stateMembershipPath but compiledProgram.stateMachines is empty.`,
      );
    }
  }
}

function assertStateMachinesAndMembershipPathsAreSupportedByPicoVerticalSliceOrThrow(compiledProgram: CompiledProgram): void {
  if (compiledProgram.stateMachines.length === 0) {
    throwIfCompiledProgramDeclaresStateMembershipWithoutStateMachinesOrThrow(compiledProgram);
    return;
  }

  const node_paths_by_machine_name = buildStateMachineNodePathsByMachineName(compiledProgram);
  for (const state_machine of compiledProgram.stateMachines) {
    const node_paths = node_paths_by_machine_name.get(state_machine.machineName);
    if (node_paths === undefined || !node_paths.has(state_machine.initialLeafPath)) {
      throw new Error(
        `Pico vertical slice: state machine "${state_machine.machineName}" initialLeafPath "${state_machine.initialLeafPath}" is not a known node path.`,
      );
    }
    for (const transition of state_machine.globalTransitions) {
      assertPicoSupportedStateMachineTransitionConditionExpressionOrThrow(transition.condition);
      if (!node_paths.has(transition.targetPath)) {
        throw new Error(
          `Pico vertical slice: global transition targetPath "${transition.targetPath}" is not a known node path in machine "${state_machine.machineName}".`,
        );
      }
    }
    for (const node of state_machine.nodes) {
      for (const transition of node.localTransitions) {
        assertPicoSupportedStateMachineTransitionConditionExpressionOrThrow(transition.condition);
        if (!node_paths.has(transition.targetPath)) {
          throw new Error(
            `Pico vertical slice: local transition targetPath "${transition.targetPath}" on node "${node.path}" is not a known node path in machine "${state_machine.machineName}".`,
          );
        }
      }
    }
  }

  for (const task of compiledProgram.everyTasks) {
    if (task.stateMembershipPath === undefined) {
      continue;
    }
    throwIfStateMembershipPathDoesNotReferenceKnownStatePrefixOrThrow({
      membership_path: task.stateMembershipPath,
      node_paths_by_machine_name,
      human_readable_context: `everyTask "${task.taskName}"`,
    });
  }
  for (const task of compiledProgram.loopTasks) {
    if (task.stateMembershipPath === undefined) {
      continue;
    }
    throwIfStateMembershipPathDoesNotReferenceKnownStatePrefixOrThrow({
      membership_path: task.stateMembershipPath,
      node_paths_by_machine_name,
      human_readable_context: `loopTask "${task.taskName}"`,
    });
  }
  for (const task of compiledProgram.onEventTasks) {
    if (task.stateMembershipPath === undefined) {
      continue;
    }
    if (task.triggerKind === "state_enter" || task.triggerKind === "state_exit") {
      throwIfStateMembershipPathIsNotExactNodePathOrThrow({
        membership_path: task.stateMembershipPath,
        node_paths_by_machine_name,
        human_readable_context: `onEventTask "${task.taskName}" (${task.triggerKind})`,
      });
      continue;
    }
    throwIfStateMembershipPathDoesNotReferenceKnownStatePrefixOrThrow({
      membership_path: task.stateMembershipPath,
      node_paths_by_machine_name,
      human_readable_context: `onEventTask "${task.taskName}" (${task.triggerKind})`,
    });
  }
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
  assertStateMachinesAndMembershipPathsAreSupportedByPicoVerticalSliceOrThrow(compiledProgram);
  if (compiledProgram.animatorDefinitions.length > 0) {
    throw new Error("Pico vertical slice does not support animator definitions yet.");
  }
  for (const task of compiledProgram.everyTasks) {
    for (const statement of task.statements) {
      assertStatementIsSupportedByPicoVerticalSliceOrThrow(statement);
    }
  }
  for (const task of compiledProgram.onEventTasks) {
    if (task.triggerKind === "device_event") {
      if (task.deviceAddress === undefined || task.eventName === undefined) {
        throw new Error(
          `Pico vertical slice: device_event onEventTask "${task.taskName}" is missing deviceAddress or eventName.`,
        );
      }
    } else if (task.triggerKind === "state_enter" || task.triggerKind === "state_exit") {
      if (task.stateMembershipPath === undefined) {
        throw new Error(
          `Pico vertical slice: onEventTask "${task.taskName}" uses ${task.triggerKind} and must declare stateMembershipPath.`,
        );
      }
    } else {
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
  const tick_from_state_machines = inferMinimumPositiveStateMachineTickIntervalMillisecondsOrUndefined(compiledProgram);
  if (tick_from_state_machines !== undefined) {
    return tick_from_state_machines;
  }
  return DEFAULT_LIVE_TICK_INTERVAL_MILLISECONDS_WHEN_NO_EVERY_TASK;
}

function inferMinimumPositiveStateMachineTickIntervalMillisecondsOrUndefined(
  compiledProgram: CompiledProgram,
): number | undefined {
  let minimum_tick_milliseconds: number | undefined;
  for (const state_machine of compiledProgram.stateMachines) {
    const tick_milliseconds = state_machine.tickIntervalMilliseconds;
    if (tick_milliseconds < 1) {
      continue;
    }
    if (minimum_tick_milliseconds === undefined || tick_milliseconds < minimum_tick_milliseconds) {
      minimum_tick_milliseconds = tick_milliseconds;
    }
  }
  return minimum_tick_milliseconds;
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
    const first_on_event_task = compiledProgram.onEventTasks[0];
    if (first_on_event_task.triggerKind === "device_event") {
      if (first_on_event_task.deviceAddress === undefined || first_on_event_task.eventName === undefined) {
        throw new Error("Missing deviceAddress/eventName on first onEventTask for automatic replay inference.");
      }
      return [
        { kind: "collect_trace" },
        {
          kind: "dispatch_device_event",
          deviceKind: first_on_event_task.deviceAddress.kind,
          deviceId: first_on_event_task.deviceAddress.id,
          eventName: first_on_event_task.eventName,
        },
        { kind: "collect_trace" },
        {
          kind: "dispatch_device_event",
          deviceKind: first_on_event_task.deviceAddress.kind,
          deviceId: first_on_event_task.deviceAddress.id,
          eventName: first_on_event_task.eventName,
        },
        { kind: "collect_trace" },
      ];
    }
  }

  const state_machine_tick_milliseconds = inferMinimumPositiveStateMachineTickIntervalMillisecondsOrUndefined(compiledProgram);
  if (state_machine_tick_milliseconds !== undefined) {
    return [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: state_machine_tick_milliseconds },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: state_machine_tick_milliseconds },
      { kind: "collect_trace" },
    ];
  }

  if (compiledProgram.onEventTasks.length > 0) {
    const first_on_event_task = compiledProgram.onEventTasks[0];
    throw new Error(
      `Unsupported onEvent triggerKind for automatic Pico package replay inference: ${first_on_event_task.triggerKind}`,
    );
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
    } else {
      const tick_from_state_machines = inferMinimumPositiveStateMachineTickIntervalMillisecondsOrUndefined(
        params.compiledProgram,
      );
      if (tick_from_state_machines !== undefined) {
        tickMilliseconds = tick_from_state_machines;
      }
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
