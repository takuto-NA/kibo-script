import { DeviceBus } from "./device-bus";
import type { DeviceEffect } from "./device-bus";
import { formatDeviceAddress, parseDeviceAddress, type DeviceAddress } from "./device-address";
import {
  mapDoMethodCallToDeviceEffects,
  type ConcreteMethodArgument,
} from "./executable-statement-to-device-effects";
import type {
  CompiledAnimatorDefinition,
  CompiledProgram,
  CompiledStateMachine,
  CompiledStateMachineNodeIr,
  ExecutableExpression,
  ExecutableStatement,
} from "./executable-task";
import type { BindProgramAmbientWorld } from "../compiler/binder";
import {
  buildRuntimeWorldDropBlockedByTasks,
  buildRuntimeWorldDuplicateName,
  buildRuntimeWorldUnknownName,
  buildRuntimeWorldVarWriterConflict,
} from "../diagnostics/diagnostic-builder";
import { createDiagnosticReport, type DiagnosticReport, type StructuredDiagnostic } from "../diagnostics/diagnostic";
import {
  collectDeviceAddressKeysFromStatements,
  collectStatePathTextsFromStatements,
  collectVarNamesReferencedFromStatements,
} from "./runtime-world-dependencies";
import { createInitialAnimatorRuntimeState, type AnimatorRuntimeState } from "./animator-runtime-state";
import {
  evaluateExecutableExpression,
  scriptValueToIntegerOrUndefined,
  scriptValueToPrintableText,
  type EvaluateExecutableExpressionContext,
} from "./evaluate-executable-expression";
import { registerCompiledProgramOnTaskRegistry } from "./register-compiled-program";
import type { DefaultDevices } from "../devices/create-default-devices";
import { createDefaultDevices, registerDefaultDevices } from "../devices/create-default-devices";
import { NoopPhysicsWorld } from "../physics/noop-physics-world";
import type { PhysicsWorld } from "../physics/physics-world";
import type { ScriptValue } from "./value";
import type { TaskRecord, TaskRegistry } from "./task-registry";

/**
 * 責務: コンパイル済みタスクと状態機械をシミュレーション時間で進め、DeviceBus へ効果を適用する。
 */

/**
 * loop / every が同一 wake-up で暴走しないための協調的上限（分岐で wait を迂回しても止められる）。
 */
const MAXIMUM_EXECUTABLE_STATEMENTS_PER_TASK_DRAIN = 50_000;

export type SimulationTickResult = {
  appliedEffectCount: number;
};

export type RegisterCompiledProgramAdditiveResult =
  | { ok: true }
  | { ok: false; report: DiagnosticReport };

export type DropRuntimeWorldEntityResult =
  | { ok: true }
  | { ok: false; report: DiagnosticReport };

export type RuntimeWorldStateMachineInspectRow = {
  machineName: string;
  activeLeafPath: string;
  tickIntervalMilliseconds: number;
  elapsedMillisecondsByLeafPath: ReadonlyMap<string, number>;
};

export type DeviceEffectAppliedListener = (effect: DeviceEffect) => void;

/**
 * cooperative every-task / on_event の時間とプログラムカウンタを進め、DeviceEffect をキューへ積む。
 */
export class SimulationRuntime {
  private readonly deviceBus: DeviceBus;
  private readonly pendingEffects: DeviceEffect[] = [];
  private readonly internalDevices: DefaultDevices;
  private readonly physicsWorld: PhysicsWorld;
  public readonly tasks: TaskRegistry;
  private totalSimulationMilliseconds = 0;
  private readonly scriptVarValues = new Map<string, number | string>();
  private readonly scriptConstValues = new Map<string, number | string>();
  private compiledAnimatorDefinitionsByName = new Map<string, CompiledAnimatorDefinition>();
  private readonly animatorRuntimeStatesByName = new Map<string, AnimatorRuntimeState>();
  private readonly statePathEntrySimulationMs = new Map<string, number>();
  private compiledStateMachines: CompiledStateMachine[] = [];
  private readonly activeLeafPathByMachineName = new Map<string, string>();
  private readonly stateMachineTickAccumulatorMsByMachineName = new Map<string, number>();
  private readonly compiledStateMachineNodeIndexByMachineName = new Map<string, Map<string, CompiledStateMachineNodeIr>>();
  private readonly onAfterDeviceEffectApplied?: DeviceEffectAppliedListener;
  /** `ref` 名 → 実デバイス（ターミナル・追加コンパイルの名前解決）。 */
  private readonly deviceAliasByRefName = new Map<string, DeviceAddress>();
  /** var → `assign_var` を持つ task 名（単一 writer メタデータ）。 */
  private readonly varWriterTaskByVarName = new Map<string, string>();

  public constructor(params: {
    deviceBus?: DeviceBus;
    devices?: DefaultDevices;
    physicsWorld?: PhysicsWorld;
    tasks: TaskRegistry;
    onAfterDeviceEffectApplied?: DeviceEffectAppliedListener;
  }) {
    this.deviceBus = params.deviceBus ?? new DeviceBus();
    this.physicsWorld = params.physicsWorld ?? new NoopPhysicsWorld();
    this.internalDevices = params.devices ?? createDefaultDevices(this.physicsWorld);
    this.tasks = params.tasks;
    this.onAfterDeviceEffectApplied = params.onAfterDeviceEffectApplied;
    registerDefaultDevices((address, device) => {
      this.deviceBus.registerDevice(address, device);
    }, this.internalDevices);
  }

  public getPhysicsWorld(): PhysicsWorld {
    return this.physicsWorld;
  }

  public getDeviceBus(): DeviceBus {
    return this.deviceBus;
  }

  public getDefaultDevices(): DefaultDevices {
    return this.internalDevices;
  }

  public getTotalSimulationMilliseconds(): number {
    return this.totalSimulationMilliseconds;
  }

  public getScriptVarValues(): ReadonlyMap<string, number | string> {
    return this.scriptVarValues;
  }

  public getScriptConstValues(): ReadonlyMap<string, number | string> {
    return this.scriptConstValues;
  }

  public getRegisteredDeviceAliasMap(): ReadonlyMap<string, DeviceAddress> {
    return this.deviceAliasByRefName;
  }

  public getVarWriterTaskNameByVarNameMap(): ReadonlyMap<string, string> {
    return this.varWriterTaskByVarName;
  }

  public buildBinderAmbientWorld(): BindProgramAmbientWorld {
    return {
      existingRefDeviceAddressesByName: this.deviceAliasByRefName,
      existingAmbientVarNames: [...this.scriptVarValues.keys()].sort((left, right) => left.localeCompare(right)),
      existingAmbientConstNames: [...this.scriptConstValues.keys()].sort((left, right) => left.localeCompare(right)),
    };
  }

  public getAmbientStatePathNodePathsForSemanticCheck(): ReadonlySet<string> {
    const paths = new Set<string>();
    for (const stateMachine of this.compiledStateMachines) {
      for (const node of stateMachine.nodes) {
        paths.add(node.path);
      }
    }
    return paths;
  }

  public resolveInteractiveTargetToDeviceAddress(targetText: string): DeviceAddress | undefined {
    const trimmed = targetText.trim();
    const direct = parseDeviceAddress(trimmed);
    if (direct.ok) {
      return direct.address;
    }
    return this.deviceAliasByRefName.get(trimmed);
  }

  public formatRegisteredDeviceAliasesLines(): string[] {
    if (this.deviceAliasByRefName.size === 0) {
      return ["(no refs)"];
    }
    const lines: string[] = [];
    const sortedNames = [...this.deviceAliasByRefName.keys()].sort((left, right) => left.localeCompare(right));
    for (const refName of sortedNames) {
      const address = this.deviceAliasByRefName.get(refName);
      if (address === undefined) {
        continue;
      }
      lines.push(`${refName} -> ${formatDeviceAddress(address)}`);
    }
    return lines;
  }

  public formatRegisteredVarsWithWritersLines(): string[] {
    if (this.scriptVarValues.size === 0 && this.varWriterTaskByVarName.size === 0) {
      return ["(no vars)"];
    }
    const lines: string[] = [];
    const sortedVarNames = [...this.scriptVarValues.keys()].sort((left, right) => left.localeCompare(right));
    for (const varName of sortedVarNames) {
      const value = this.scriptVarValues.get(varName);
      const writerTaskName = this.varWriterTaskByVarName.get(varName);
      const writerLabel = writerTaskName !== undefined ? writerTaskName : "(no writer metadata)";
      lines.push(`${varName}\t${String(value)}\twriter=${writerLabel}`);
    }
    return lines;
  }

  public listStateMachineInspectRows(): RuntimeWorldStateMachineInspectRow[] {
    const rows: RuntimeWorldStateMachineInspectRow[] = [];
    for (const stateMachine of this.compiledStateMachines) {
      const activeLeafPath = this.activeLeafPathByMachineName.get(stateMachine.machineName);
      if (activeLeafPath === undefined) {
        continue;
      }
      const elapsedByLeaf = new Map<string, number>();
      for (const node of stateMachine.nodes) {
        if (node.childPaths.length > 0) {
          continue;
        }
        elapsedByLeaf.set(node.path, this.getElapsedMsForStatePath(node.path));
      }
      rows.push({
        machineName: stateMachine.machineName,
        activeLeafPath,
        tickIntervalMilliseconds: stateMachine.tickIntervalMilliseconds,
        elapsedMillisecondsByLeafPath: elapsedByLeaf,
      });
    }
    return rows;
  }

  public formatStateMachineInspectLines(): string[] {
    const rows = this.listStateMachineInspectRows();
    if (rows.length === 0) {
      return ["(no state machines)"];
    }
    const lines: string[] = [];
    for (const row of rows) {
      lines.push(
        `machine=${row.machineName}\tactiveLeaf=${row.activeLeafPath}\ttickMs=${row.tickIntervalMilliseconds}`,
      );
      const sortedLeaves = [...row.elapsedMillisecondsByLeafPath.keys()].sort((left, right) =>
        left.localeCompare(right),
      );
      for (const leafPath of sortedLeaves) {
        const elapsedMs = row.elapsedMillisecondsByLeafPath.get(leafPath) ?? 0;
        lines.push(`  ${leafPath}\telapsedMs=${elapsedMs}`);
      }
    }
    return lines;
  }

  public tryRegisterCompiledProgramAdditive(compiledProgram: CompiledProgram): RegisterCompiledProgramAdditiveResult {
    const diagnostics = this.collectAdditiveRegistrationDiagnostics(compiledProgram);
    if (diagnostics.length > 0) {
      return { ok: false, report: createDiagnosticReport(diagnostics) };
    }
    this.applyAdditiveCompiledProgram(compiledProgram);
    return { ok: true };
  }

  public removeTaskAndReleaseRuntimeWriters(taskName: string): boolean {
    const removed = this.tasks.removeTask(taskName);
    if (!removed) {
      return false;
    }
    for (const [varName, writerTaskName] of [...this.varWriterTaskByVarName.entries()]) {
      if (writerTaskName === taskName) {
        this.varWriterTaskByVarName.delete(varName);
      }
    }
    return true;
  }

  public tryDropRef(refName: string): DropRuntimeWorldEntityResult {
    const address = this.deviceAliasByRefName.get(refName);
    if (address === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildRuntimeWorldUnknownName({ kind: "ref", name: refName }),
        ]),
      };
    }
    const dependentTasks = this.findTasksDependingOnDeviceAddress(address);
    if (dependentTasks.length > 0) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildRuntimeWorldDropBlockedByTasks({
            resourceDescription: `drop ref "${refName}"`,
            dependentTaskNames: dependentTasks.map((task) => task.name),
          }),
        ]),
      };
    }
    this.deviceAliasByRefName.delete(refName);
    return { ok: true };
  }

  public tryDropVar(varName: string): DropRuntimeWorldEntityResult {
    if (!this.scriptVarValues.has(varName)) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildRuntimeWorldUnknownName({ kind: "var", name: varName }),
        ]),
      };
    }
    const dependentTasks = this.findTasksDependingOnVarName(varName);
    if (dependentTasks.length > 0) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildRuntimeWorldDropBlockedByTasks({
            resourceDescription: `drop var "${varName}"`,
            dependentTaskNames: dependentTasks.map((task) => task.name),
          }),
        ]),
      };
    }
    this.scriptVarValues.delete(varName);
    this.varWriterTaskByVarName.delete(varName);
    return { ok: true };
  }

  public tryDropStatePath(statePathPrefix: string): DropRuntimeWorldEntityResult {
    const normalizedPrefix = statePathPrefix.trim();
    if (normalizedPrefix.includes(".")) {
      return {
        ok: false,
        report: createDiagnosticReport([
          {
            id: "runtime.world.state_drop_requires_machine_root",
            severity: "error",
            phase: "runtime",
            message:
              'drop state currently accepts only a state machine root name (e.g. "oled"), not a dotted child path.',
          },
        ]),
      };
    }
    const dependentTasks = this.findTasksDependingOnStateMachineRoot(normalizedPrefix);
    if (dependentTasks.length > 0) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildRuntimeWorldDropBlockedByTasks({
            resourceDescription: `drop state prefix "${normalizedPrefix}"`,
            dependentTaskNames: dependentTasks.map((task) => task.name),
          }),
        ]),
      };
    }
    const removed = this.removeStateMachineRootByMachineName(normalizedPrefix);
    if (!removed) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildRuntimeWorldUnknownName({ kind: "state_path", name: normalizedPrefix }),
        ]),
      };
    }
    return { ok: true };
  }

  private replaceRuntimeWorldMetadataFromProgram(compiledProgram: CompiledProgram): void {
    this.deviceAliasByRefName.clear();
    for (const alias of compiledProgram.deviceAliases) {
      this.deviceAliasByRefName.set(alias.refName, alias.deviceAddress);
    }
    this.varWriterTaskByVarName.clear();
    for (const row of compiledProgram.varWriterAssignments) {
      this.varWriterTaskByVarName.set(row.varName, row.writerTaskName);
    }
  }

  private applyAdditiveCompiledProgram(compiledProgram: CompiledProgram): void {
    for (const definition of compiledProgram.animatorDefinitions) {
      this.compiledAnimatorDefinitionsByName.set(definition.animatorName, definition);
      if (!this.animatorRuntimeStatesByName.has(definition.animatorName)) {
        this.animatorRuntimeStatesByName.set(
          definition.animatorName,
          createInitialAnimatorRuntimeState(definition),
        );
      }
    }
    for (const alias of compiledProgram.deviceAliases) {
      this.deviceAliasByRefName.set(alias.refName, alias.deviceAddress);
    }
    for (const row of compiledProgram.varWriterAssignments) {
      this.varWriterTaskByVarName.set(row.varName, row.writerTaskName);
    }
    this.mergeScriptStateFromAdditiveProgram(compiledProgram);
    this.appendCompiledStateMachinesFromAdditiveProgram(compiledProgram);
    registerCompiledProgramOnTaskRegistry({
      taskRegistry: this.tasks,
      compiledProgram,
    });
    this.dispatchInitialEnterLifecycleForNewStateMachines(compiledProgram.stateMachines);
    this.startRunnableLoopTasks();
    this.flushPendingEffects();
  }

  private mergeScriptStateFromAdditiveProgram(compiledProgram: CompiledProgram): void {
    const evaluationContextBase = this.createEvaluationContextForStateInitialization();
    for (const initializer of compiledProgram.varInitializers) {
      if (this.scriptVarValues.has(initializer.varName)) {
        continue;
      }
      const scriptValue = evaluateExecutableExpression(initializer.expression, evaluationContextBase);
      if (scriptValue === undefined) {
        continue;
      }
      if (scriptValue.tag === "integer") {
        this.scriptVarValues.set(initializer.varName, scriptValue.value);
        continue;
      }
      if (scriptValue.tag === "string") {
        this.scriptVarValues.set(initializer.varName, scriptValue.value);
      }
    }

    const evaluationContextWithConsts = this.createEvaluationContextForStateInitialization();
    for (const initializer of compiledProgram.constInitializers) {
      if (this.scriptConstValues.has(initializer.constName)) {
        continue;
      }
      const scriptValue = evaluateExecutableExpression(initializer.expression, evaluationContextWithConsts);
      if (scriptValue === undefined) {
        continue;
      }
      if (scriptValue.tag === "integer") {
        this.scriptConstValues.set(initializer.constName, scriptValue.value);
        continue;
      }
      if (scriptValue.tag === "string") {
        this.scriptConstValues.set(initializer.constName, scriptValue.value);
      }
    }
  }

  private appendCompiledStateMachinesFromAdditiveProgram(compiledProgram: CompiledProgram): void {
    for (const stateMachine of compiledProgram.stateMachines) {
      const nodeIndex = buildCompiledStateMachineNodeIndex(stateMachine.nodes);
      this.compiledStateMachineNodeIndexByMachineName.set(stateMachine.machineName, nodeIndex);
      this.activeLeafPathByMachineName.set(stateMachine.machineName, stateMachine.initialLeafPath);
      this.stateMachineTickAccumulatorMsByMachineName.set(stateMachine.machineName, 0);
      this.seedStatePathEntryTimesForLeafPath(stateMachine.initialLeafPath);
    }
    this.compiledStateMachines = [...this.compiledStateMachines, ...compiledProgram.stateMachines];
  }

  private dispatchInitialEnterLifecycleForNewStateMachines(newStateMachines: CompiledStateMachine[]): void {
    for (const stateMachine of newStateMachines) {
      const activeLeafPath = this.activeLeafPathByMachineName.get(stateMachine.machineName);
      if (activeLeafPath === undefined) {
        continue;
      }
      const enterPathSequence = computeEnterPathSequence(undefined, activeLeafPath);
      for (const enterPath of enterPathSequence) {
        this.dispatchLifecycleEnterTasksForExactMembershipPath(enterPath);
      }
    }
  }

  /**
   * 登録済み task を破棄し、CompiledProgram の var 初期化と task 再登録を行う。
   */
  public replaceCompiledProgram(compiledProgram: CompiledProgram): void {
    this.compiledAnimatorDefinitionsByName = new Map(
      compiledProgram.animatorDefinitions.map((definition) => [definition.animatorName, definition]),
    );
    this.animatorRuntimeStatesByName.clear();
    for (const definition of compiledProgram.animatorDefinitions) {
      this.animatorRuntimeStatesByName.set(definition.animatorName, createInitialAnimatorRuntimeState(definition));
    }
    this.tasks.clearAllTasks();
    this.initializeScriptStateFromCompiledProgram(compiledProgram);
    this.replaceRuntimeWorldMetadataFromProgram(compiledProgram);
    this.initializeCompiledStateMachines(compiledProgram);
    registerCompiledProgramOnTaskRegistry({
      taskRegistry: this.tasks,
      compiledProgram,
    });
    this.dispatchInitialEnterLifecycleForAllStateMachines();
    this.startRunnableLoopTasks();
    this.flushPendingEffects();
  }

  private initializeScriptStateFromCompiledProgram(compiledProgram: CompiledProgram): void {
    this.scriptVarValues.clear();
    this.scriptConstValues.clear();
    const evaluationContextBase = this.createEvaluationContextForStateInitialization();
    for (const initializer of compiledProgram.varInitializers) {
      const scriptValue = evaluateExecutableExpression(initializer.expression, evaluationContextBase);
      if (scriptValue === undefined) {
        continue;
      }
      if (scriptValue.tag === "integer") {
        this.scriptVarValues.set(initializer.varName, scriptValue.value);
        continue;
      }
      if (scriptValue.tag === "string") {
        this.scriptVarValues.set(initializer.varName, scriptValue.value);
      }
    }

    const evaluationContextWithConsts = this.createEvaluationContextForStateInitialization();
    for (const initializer of compiledProgram.constInitializers) {
      const scriptValue = evaluateExecutableExpression(initializer.expression, evaluationContextWithConsts);
      if (scriptValue === undefined) {
        continue;
      }
      if (scriptValue.tag === "integer") {
        this.scriptConstValues.set(initializer.constName, scriptValue.value);
        continue;
      }
      if (scriptValue.tag === "string") {
        this.scriptConstValues.set(initializer.constName, scriptValue.value);
      }
    }
  }

  public queueEffect(effect: DeviceEffect): void {
    this.pendingEffects.push(effect);
  }

  public queueEffects(effects: DeviceEffect[]): void {
    this.pendingEffects.push(...effects);
  }

  /**
   * `task on` 登録タスクを同期的に起動する（テスト / UI / embed から呼ぶ）。
   */
  public dispatchScriptEvent(params: { deviceAddress: DeviceAddress; eventName: string }): void {
    for (const task of this.tasks.listTasks()) {
      if (!task.running || task.runMode !== "on_event") {
        continue;
      }
      if (task.onEventTriggerKind === "state_enter" || task.onEventTriggerKind === "state_exit") {
        continue;
      }
      const filter = task.onEventFilter;
      if (filter === undefined) {
        continue;
      }
      if (
        filter.deviceAddress.kind !== params.deviceAddress.kind ||
        filter.deviceAddress.id !== params.deviceAddress.id
      ) {
        continue;
      }
      if (filter.eventName !== params.eventName) {
        continue;
      }
      if (!this.isTaskRunnableGivenStateMembership(task)) {
        continue;
      }
      if (task.executionProgress !== undefined) {
        continue;
      }
      task.executionProgress = {
        programCounter: 0,
        resumeAtTotalMilliseconds: undefined,
      };
      this.drainTaskExecution(task);
    }
    this.flushPendingEffects();
  }

  public tick(elapsedMilliseconds: number): SimulationTickResult {
    this.totalSimulationMilliseconds += elapsedMilliseconds;
    this.resumeWaitingTasks();
    this.advanceStateMachines(elapsedMilliseconds);
    this.advanceEveryTasks(elapsedMilliseconds);
    this.startRunnableLoopTasks();
    const appliedEffectCount = this.flushPendingEffects();
    return { appliedEffectCount };
  }

  private createEvaluationContextForStateInitialization(): EvaluateExecutableExpressionContext {
    return {
      deviceBus: this.deviceBus,
      varValues: this.scriptVarValues,
      constValues: this.scriptConstValues,
      resolveStatePathElapsedMilliseconds: (path) => this.getElapsedMsForStatePath(path),
    };
  }

  private createEvaluationContextForTask(task: TaskRecord): EvaluateExecutableExpressionContext {
    if (task.taskLocalValues === undefined) {
      task.taskLocalValues = new Map();
    }
    return {
      deviceBus: this.deviceBus,
      varValues: this.scriptVarValues,
      constValues: this.scriptConstValues,
      tempValues: task.taskLocalValues,
      taskExecution: {
        runMode: task.runMode,
        nominalIntervalMilliseconds: task.intervalMilliseconds,
      },
      animatorDefinitionsByName: this.compiledAnimatorDefinitionsByName,
      animatorRuntimeStatesByName: this.animatorRuntimeStatesByName,
      resolveStatePathElapsedMilliseconds: (path) => this.getElapsedMsForStatePath(path),
    };
  }

  private flushPendingEffects(): number {
    let appliedEffectCount = 0;
    for (const effect of this.pendingEffects) {
      const wasApplied = this.deviceBus.applyEffect(effect);
      if (!wasApplied) {
        continue;
      }
      appliedEffectCount += 1;
      this.onAfterDeviceEffectApplied?.(effect);
    }
    this.pendingEffects.length = 0;
    return appliedEffectCount;
  }

  private resumeWaitingTasks(): void {
    for (const task of this.tasks.listTasks()) {
      if (!task.running) {
        continue;
      }
      if (task.runMode !== "every" && task.runMode !== "loop") {
        continue;
      }
      const progress = task.executionProgress;
      if (progress === undefined || progress.resumeAtTotalMilliseconds === undefined) {
        continue;
      }
      if (this.totalSimulationMilliseconds < progress.resumeAtTotalMilliseconds) {
        continue;
      }
      if (!this.isTaskRunnableGivenStateMembership(task)) {
        continue;
      }
      progress.resumeAtTotalMilliseconds = undefined;
      this.drainTaskExecution(task);
    }
  }

  private startRunnableLoopTasks(): void {
    for (const task of this.tasks.listTasks()) {
      if (!task.running || task.runMode !== "loop") {
        continue;
      }
      if (!this.isTaskRunnableGivenStateMembership(task)) {
        continue;
      }
      if (task.compiledStatements === undefined) {
        continue;
      }
      if (task.executionProgress === undefined) {
        task.executionProgress = {
          programCounter: 0,
          resumeAtTotalMilliseconds: undefined,
        };
        this.drainTaskExecution(task);
        continue;
      }

      const progress = task.executionProgress;
      if (progress.resumeAtTotalMilliseconds !== undefined) {
        continue;
      }
      if (progress.programCounter !== 0) {
        continue;
      }

      this.drainTaskExecution(task);
    }
  }
  private advanceEveryTasks(elapsedMilliseconds: number): void {
    for (const task of this.tasks.listTasks()) {
      if (!task.running || task.runMode !== "every") {
        continue;
      }
      const interval = task.intervalMilliseconds;
      if (interval === undefined || interval <= 0) {
        continue;
      }
      task.accumulatedMilliseconds += elapsedMilliseconds;
      while (task.accumulatedMilliseconds >= interval) {
        task.accumulatedMilliseconds -= interval;
        if (task.executionProgress !== undefined) {
          continue;
        }
        if (!this.isTaskRunnableGivenStateMembership(task)) {
          continue;
        }
        task.executionProgress = {
          programCounter: 0,
          resumeAtTotalMilliseconds: undefined,
        };
        this.drainTaskExecution(task);
      }
    }
  }

  private drainTaskExecution(task: TaskRecord): void {
    if (!this.isTaskRunnableGivenStateMembership(task)) {
      task.executionProgress = undefined;
      return;
    }
    const statements = task.compiledStatements;
    if (statements === undefined) {
      task.executionProgress = undefined;
      return;
    }

    if (task.executionProgress === undefined) {
      task.executionProgress = {
        programCounter: 0,
        resumeAtTotalMilliseconds: undefined,
      };
    }

    let remainingExecutableStatementBudget = MAXIMUM_EXECUTABLE_STATEMENTS_PER_TASK_DRAIN;

    while (task.executionProgress.programCounter < statements.length) {
      if (remainingExecutableStatementBudget <= 0) {
        this.stopTaskAfterExecutableStatementBudgetExceeded(task);
        return;
      }
      remainingExecutableStatementBudget -= 1;

      const programCounter = task.executionProgress.programCounter;
      if (programCounter === 0) {
        task.taskLocalValues = new Map();
      }
      const statement = statements[programCounter];

      if (statement.kind === "assign_temp") {
        this.executeAssignTempStatement(statement, task);
        task.executionProgress.programCounter = programCounter + 1;
        continue;
      }

      if (statement.kind === "if_comparison") {
        this.executeIfComparisonStatement(statement, task);
        task.executionProgress.programCounter = programCounter + 1;
        continue;
      }

      if (statement.kind === "wait_milliseconds") {
        const waitMilliseconds = this.evaluateWaitDurationMillisecondsOrStopTask({
          durationExpression: statement.durationMillisecondsExpression,
          task,
        });
        if (waitMilliseconds === undefined) {
          return;
        }
        task.executionProgress.resumeAtTotalMilliseconds = this.totalSimulationMilliseconds + waitMilliseconds;
        task.executionProgress.programCounter = programCounter + 1;
        return;
      }

      if (statement.kind === "assign_var") {
        this.executeAssignVarStatement(statement, task);
        task.executionProgress.programCounter = programCounter + 1;
        continue;
      }

      if (statement.kind === "do_method_call") {
        const effects = this.effectsForDoMethodCall(statement, task);
        this.queueEffects(effects);
        task.executionProgress.programCounter = programCounter + 1;
        continue;
      }

      if (statement.kind === "match_string") {
        this.executeMatchStringStatement(statement, task);
        task.executionProgress.programCounter = programCounter + 1;
        continue;
      }
    }

    if (task.runMode === "loop") {
      task.executionProgress.programCounter = 0;
      return;
    }

    task.executionProgress = undefined;
  }

  private evaluateWaitDurationMillisecondsOrStopTask(params: {
    durationExpression: ExecutableExpression;
    task: TaskRecord;
  }): number | undefined {
    const evaluationContext = this.createEvaluationContextForTask(params.task);
    const durationValue = evaluateExecutableExpression(params.durationExpression, evaluationContext);
    if (durationValue === undefined) {
      this.stopTaskAfterInvalidWaitDurationExpression(params.task);
      return undefined;
    }
    const durationMilliseconds = scriptValueToIntegerOrUndefined(durationValue);
    if (durationMilliseconds === undefined) {
      this.stopTaskAfterInvalidWaitDurationExpression(params.task);
      return undefined;
    }
    if (durationMilliseconds <= 0) {
      this.stopTaskAfterInvalidWaitDurationExpression(params.task);
      return undefined;
    }
    return durationMilliseconds;
  }

  private stopTaskAfterInvalidWaitDurationExpression(task: TaskRecord): void {
    task.running = false;
    task.executionProgress = undefined;
  }

  private stopTaskAfterExecutableStatementBudgetExceeded(task: TaskRecord): void {
    task.running = false;
    task.executionProgress = undefined;
  }

  private executeMatchStringStatement(
    statement: ExecutableStatement & { kind: "match_string" },
    task: TaskRecord,
  ): void {
    const evaluationContext = this.createEvaluationContextForTask(task);
    const scriptValue = evaluateExecutableExpression(statement.targetExpression, evaluationContext);
    let chosenBranchStatements: ExecutableStatement[] | undefined;
    if (scriptValue !== undefined && scriptValue.tag === "string") {
      const matchedText = scriptValue.value;
      for (const stringCase of statement.stringCases) {
        if (stringCase.patternString === matchedText) {
          chosenBranchStatements = stringCase.branchStatements;
          break;
        }
      }
    }
    const statementsToExecute =
      chosenBranchStatements !== undefined ? chosenBranchStatements : statement.elseBranchStatements;
    this.executeExecutableStatementsWithoutWaiting(statementsToExecute, task);
  }

  /**
   * match 分岐内など、wait で中断しないブロック向け。型検査で分岐内 wait は拒否する。
   */
  private executeExecutableStatementsWithoutWaiting(
    statements: ExecutableStatement[],
    task: TaskRecord,
  ): void {
    for (const innerStatement of statements) {
      if (innerStatement.kind === "do_method_call") {
        const effects = this.effectsForDoMethodCall(innerStatement, task);
        this.queueEffects(effects);
        continue;
      }

      if (innerStatement.kind === "assign_var") {
        this.executeAssignVarStatement(innerStatement, task);
        continue;
      }

      if (innerStatement.kind === "match_string") {
        this.executeMatchStringStatement(innerStatement, task);
        continue;
      }

      if (innerStatement.kind === "assign_temp") {
        this.executeAssignTempStatement(innerStatement, task);
        continue;
      }

      if (innerStatement.kind === "if_comparison") {
        this.executeIfComparisonStatement(innerStatement, task);
        continue;
      }

      // ガード: match 分岐に wait が混入した場合はここへ来る。型検査で禁止済みのため noop でよい。
      if (innerStatement.kind === "wait_milliseconds") {
        return;
      }
    }
  }

  private executeAssignTempStatement(
    statement: ExecutableStatement & { kind: "assign_temp" },
    task: TaskRecord,
  ): void {
    const evaluationContext = this.createEvaluationContextForTask(task);
    const scriptValue = evaluateExecutableExpression(statement.valueExpression, evaluationContext);
    if (scriptValue === undefined) {
      return;
    }
    if (task.taskLocalValues === undefined) {
      task.taskLocalValues = new Map();
    }
    if (scriptValue.tag === "integer") {
      task.taskLocalValues.set(statement.tempName, scriptValue.value);
      return;
    }
    if (scriptValue.tag === "string") {
      task.taskLocalValues.set(statement.tempName, scriptValue.value);
    }
  }

  private executeIfComparisonStatement(
    statement: ExecutableStatement & { kind: "if_comparison" },
    task: TaskRecord,
  ): void {
    const evaluationContext = this.createEvaluationContextForTask(task);
    const conditionValue = evaluateExecutableExpression(statement.conditionExpression, evaluationContext);
    const conditionInteger =
      conditionValue === undefined ? undefined : scriptValueToIntegerOrUndefined(conditionValue);
    const conditionIsTruthy = conditionInteger !== undefined && conditionInteger !== 0;
    const branchStatements = conditionIsTruthy ? statement.thenBranchStatements : statement.elseBranchStatements;
    this.executeExecutableStatementsWithoutWaiting(branchStatements, task);
  }

  private executeAssignVarStatement(
    statement: ExecutableStatement & { kind: "assign_var" },
    task: TaskRecord,
  ): void {
    const evaluationContext = this.createEvaluationContextForTask(task);
    const scriptValue = evaluateExecutableExpression(statement.valueExpression, evaluationContext);
    if (scriptValue === undefined) {
      return;
    }
    if (scriptValue.tag === "integer") {
      this.scriptVarValues.set(statement.varName, scriptValue.value);
      return;
    }
    if (scriptValue.tag === "string") {
      this.scriptVarValues.set(statement.varName, scriptValue.value);
    }
  }

  private effectsForDoMethodCall(
    statement: ExecutableStatement & { kind: "do_method_call" },
    task: TaskRecord,
  ): DeviceEffect[] {
    const evaluationContext = this.createEvaluationContextForTask(task);

    if (statement.deviceAddress.kind === "serial" && statement.methodName === "println") {
      const firstArgument = statement.arguments[0];
      if (firstArgument === undefined) {
        return [];
      }
      const printableValue = evaluateExecutableExpression(firstArgument, evaluationContext);
      if (printableValue === undefined) {
        return [];
      }
      const text = scriptValueToPrintableText(printableValue);
      return mapDoMethodCallToDeviceEffects({
        deviceAddress: statement.deviceAddress,
        methodName: statement.methodName,
        concreteArguments: [{ kind: "string", value: text }],
      });
    }

    const concreteArguments: ConcreteMethodArgument[] = [];
    for (const argumentExpression of statement.arguments) {
      const scriptValue = evaluateExecutableExpression(argumentExpression, evaluationContext);
      const concrete = scriptValueToConcreteArgument(scriptValue);
      if (concrete === undefined) {
        return [];
      }
      concreteArguments.push(concrete);
    }

    return mapDoMethodCallToDeviceEffects({
      deviceAddress: statement.deviceAddress,
      methodName: statement.methodName,
      concreteArguments,
    });
  }

  private initializeCompiledStateMachines(compiledProgram: CompiledProgram): void {
    this.compiledStateMachines = compiledProgram.stateMachines;
    this.compiledStateMachineNodeIndexByMachineName.clear();
    this.activeLeafPathByMachineName.clear();
    this.stateMachineTickAccumulatorMsByMachineName.clear();
    this.statePathEntrySimulationMs.clear();

    for (const stateMachine of compiledProgram.stateMachines) {
      const nodeIndex = buildCompiledStateMachineNodeIndex(stateMachine.nodes);
      this.compiledStateMachineNodeIndexByMachineName.set(stateMachine.machineName, nodeIndex);
      this.activeLeafPathByMachineName.set(stateMachine.machineName, stateMachine.initialLeafPath);
      this.stateMachineTickAccumulatorMsByMachineName.set(stateMachine.machineName, 0);
      this.seedStatePathEntryTimesForLeafPath(stateMachine.initialLeafPath);
    }
  }

  private seedStatePathEntryTimesForLeafPath(leafPath: string): void {
    const timestampMilliseconds = this.totalSimulationMilliseconds;
    for (const prefixPath of enumerateDotPathPrefixes(leafPath)) {
      this.statePathEntrySimulationMs.set(prefixPath, timestampMilliseconds);
    }
  }

  private dispatchInitialEnterLifecycleForAllStateMachines(): void {
    for (const stateMachine of this.compiledStateMachines) {
      const activeLeafPath = this.activeLeafPathByMachineName.get(stateMachine.machineName);
      if (activeLeafPath === undefined) {
        continue;
      }
      const enterPathSequence = computeEnterPathSequence(undefined, activeLeafPath);
      for (const enterPath of enterPathSequence) {
        this.dispatchLifecycleEnterTasksForExactMembershipPath(enterPath);
      }
    }
  }

  private getElapsedMsForStatePath(statePath: string): number {
    const entrySimulationMs = this.statePathEntrySimulationMs.get(statePath);
    if (entrySimulationMs === undefined) {
      return 0;
    }
    return this.totalSimulationMilliseconds - entrySimulationMs;
  }

  private isTaskRunnableGivenStateMembership(task: TaskRecord): boolean {
    const membershipPath = task.stateMembershipPath;
    if (membershipPath === undefined) {
      return true;
    }
    const machineName = membershipPath.split(".")[0];
    const activeLeafPath = this.activeLeafPathByMachineName.get(machineName);
    if (activeLeafPath === undefined) {
      return false;
    }
    return activeLeafPath === membershipPath || activeLeafPath.startsWith(`${membershipPath}.`);
  }

  private advanceStateMachines(elapsedMilliseconds: number): void {
    for (const stateMachine of this.compiledStateMachines) {
      const tickIntervalMilliseconds = stateMachine.tickIntervalMilliseconds;
      if (tickIntervalMilliseconds <= 0) {
        this.stateMachineTickAccumulatorMsByMachineName.set(stateMachine.machineName, 0);
        continue;
      }

      let accumulatedMilliseconds =
        this.stateMachineTickAccumulatorMsByMachineName.get(stateMachine.machineName) ?? 0;
      accumulatedMilliseconds += elapsedMilliseconds;

      while (accumulatedMilliseconds >= tickIntervalMilliseconds) {
        accumulatedMilliseconds -= tickIntervalMilliseconds;
        this.runSingleStateMachineTick(stateMachine);
      }

      this.stateMachineTickAccumulatorMsByMachineName.set(stateMachine.machineName, accumulatedMilliseconds);
    }
  }

  private runSingleStateMachineTick(stateMachine: CompiledStateMachine): void {
    const nodeIndex = this.compiledStateMachineNodeIndexByMachineName.get(stateMachine.machineName);
    if (nodeIndex === undefined) {
      return;
    }

    const activeLeafPath = this.activeLeafPathByMachineName.get(stateMachine.machineName);
    if (activeLeafPath === undefined) {
      return;
    }

    const transitionTargetPath = this.evaluateFirstMatchingTransitionTarget({
      stateMachine,
      activeLeafPath,
      nodeIndex,
    });

    if (transitionTargetPath === undefined) {
      return;
    }

    const resolvedNewLeafPath = this.resolveConfiguredLeafPath(nodeIndex, transitionTargetPath);
    if (resolvedNewLeafPath === undefined || resolvedNewLeafPath === activeLeafPath) {
      return;
    }

    this.applyStateMachineLeafTransition({
      machineName: stateMachine.machineName,
      oldLeafPath: activeLeafPath,
      newLeafPath: resolvedNewLeafPath,
    });
  }

  private evaluateFirstMatchingTransitionTarget(params: {
    stateMachine: CompiledStateMachine;
    activeLeafPath: string;
    nodeIndex: Map<string, CompiledStateMachineNodeIr>;
  }): string | undefined {
    const evaluationContext = this.createEvaluationContextForStateInitialization();

    for (const transition of params.stateMachine.globalTransitions) {
      const conditionValue = evaluateExecutableExpression(transition.condition, evaluationContext);
      const conditionInteger =
        conditionValue === undefined ? undefined : scriptValueToIntegerOrUndefined(conditionValue);
      if (conditionInteger !== undefined && conditionInteger !== 0) {
        return transition.targetPath;
      }
    }

    let cursorNodePath: string | undefined = params.activeLeafPath;
    while (cursorNodePath !== undefined) {
      const stateNode = params.nodeIndex.get(cursorNodePath);
      if (stateNode !== undefined) {
        for (const transition of stateNode.localTransitions) {
          const conditionValue = evaluateExecutableExpression(transition.condition, evaluationContext);
          const conditionInteger =
            conditionValue === undefined ? undefined : scriptValueToIntegerOrUndefined(conditionValue);
          if (conditionInteger !== undefined && conditionInteger !== 0) {
            return transition.targetPath;
          }
        }
      }
      cursorNodePath = parentDotPath(cursorNodePath);
    }

    return undefined;
  }

  private resolveConfiguredLeafPath(
    nodeIndex: Map<string, CompiledStateMachineNodeIr>,
    path: string,
  ): string | undefined {
    const node = nodeIndex.get(path);
    if (node === undefined) {
      return undefined;
    }
    if (node.childPaths.length === 0) {
      return path;
    }
    if (node.initialChildLeafPath === undefined) {
      return undefined;
    }
    return this.resolveConfiguredLeafPath(nodeIndex, node.initialChildLeafPath);
  }

  private applyStateMachineLeafTransition(params: {
    machineName: string;
    oldLeafPath: string;
    newLeafPath: string;
  }): void {
    const exitPathSequence = computeExitPathSequence(params.oldLeafPath, params.newLeafPath);
    for (const exitPath of exitPathSequence) {
      this.dispatchLifecycleExitTasksForExactMembershipPath(exitPath);
    }

    this.activeLeafPathByMachineName.set(params.machineName, params.newLeafPath);

    const enterPathSequence = computeEnterPathSequence(params.oldLeafPath, params.newLeafPath);
    const transitionTimestampMilliseconds = this.totalSimulationMilliseconds;
    for (const enterPath of enterPathSequence) {
      this.statePathEntrySimulationMs.set(enterPath, transitionTimestampMilliseconds);
    }

    for (const enterPath of enterPathSequence) {
      this.dispatchLifecycleEnterTasksForExactMembershipPath(enterPath);
    }
  }

  private dispatchLifecycleExitTasksForExactMembershipPath(membershipPath: string): void {
    for (const task of this.tasks.listTasks()) {
      if (!task.running || task.runMode !== "on_event") {
        continue;
      }
      if (task.onEventTriggerKind !== "state_exit") {
        continue;
      }
      if (task.stateMembershipPath !== membershipPath) {
        continue;
      }
      task.executionProgress = {
        programCounter: 0,
        resumeAtTotalMilliseconds: undefined,
      };
      this.drainTaskExecution(task);
    }
  }

  private dispatchLifecycleEnterTasksForExactMembershipPath(membershipPath: string): void {
    for (const task of this.tasks.listTasks()) {
      if (!task.running || task.runMode !== "on_event") {
        continue;
      }
      if (task.onEventTriggerKind !== "state_enter") {
        continue;
      }
      if (task.stateMembershipPath !== membershipPath) {
        continue;
      }
      task.executionProgress = {
        programCounter: 0,
        resumeAtTotalMilliseconds: undefined,
      };
      this.drainTaskExecution(task);
    }
  }

  private collectAdditiveRegistrationDiagnostics(compiledProgram: CompiledProgram): StructuredDiagnostic[] {
    const diagnostics: StructuredDiagnostic[] = [];
    const existingTaskNames = new Set(this.tasks.listTasks().map((taskRecord) => taskRecord.name));

    for (const everyTask of compiledProgram.everyTasks) {
      if (existingTaskNames.has(everyTask.taskName)) {
        diagnostics.push(buildRuntimeWorldDuplicateName({ kind: "task", name: everyTask.taskName }));
      }
    }
    for (const loopTask of compiledProgram.loopTasks) {
      if (existingTaskNames.has(loopTask.taskName)) {
        diagnostics.push(buildRuntimeWorldDuplicateName({ kind: "task", name: loopTask.taskName }));
      }
    }
    for (const onTask of compiledProgram.onEventTasks) {
      if (existingTaskNames.has(onTask.taskName)) {
        diagnostics.push(buildRuntimeWorldDuplicateName({ kind: "task", name: onTask.taskName }));
      }
    }

    for (const alias of compiledProgram.deviceAliases) {
      if (this.deviceAliasByRefName.has(alias.refName)) {
        diagnostics.push(buildRuntimeWorldDuplicateName({ kind: "ref", name: alias.refName }));
      }
    }

    for (const initializer of compiledProgram.varInitializers) {
      if (this.scriptVarValues.has(initializer.varName)) {
        diagnostics.push(buildRuntimeWorldDuplicateName({ kind: "var", name: initializer.varName }));
      }
    }

    for (const initializer of compiledProgram.constInitializers) {
      if (this.scriptConstValues.has(initializer.constName)) {
        diagnostics.push(buildRuntimeWorldDuplicateName({ kind: "const", name: initializer.constName }));
      }
    }

    for (const stateMachine of compiledProgram.stateMachines) {
      if (this.compiledStateMachines.some((existing) => existing.machineName === stateMachine.machineName)) {
        diagnostics.push(
          buildRuntimeWorldDuplicateName({ kind: "state_machine", name: stateMachine.machineName }),
        );
      }
    }

    for (const definition of compiledProgram.animatorDefinitions) {
      if (this.compiledAnimatorDefinitionsByName.has(definition.animatorName)) {
        diagnostics.push(buildRuntimeWorldDuplicateName({ kind: "animator", name: definition.animatorName }));
      }
    }

    for (const row of compiledProgram.varWriterAssignments) {
      const existingWriterTaskName = this.varWriterTaskByVarName.get(row.varName);
      if (existingWriterTaskName !== undefined && existingWriterTaskName !== row.writerTaskName) {
        diagnostics.push(
          buildRuntimeWorldVarWriterConflict({
            varName: row.varName,
            existingWriterTaskName,
            incomingWriterTaskName: row.writerTaskName,
          }),
        );
      }
    }

    return diagnostics;
  }

  private findTasksDependingOnDeviceAddress(deviceAddress: DeviceAddress): TaskRecord[] {
    const addressKey = formatDeviceAddress(deviceAddress);
    const dependents: TaskRecord[] = [];
    for (const task of this.tasks.listTasks()) {
      const statements = task.compiledStatements;
      if (statements === undefined) {
        continue;
      }
      const keys = collectDeviceAddressKeysFromStatements(statements);
      if (keys.has(addressKey)) {
        dependents.push(task);
      }
    }
    return dependents;
  }

  private findTasksDependingOnVarName(varName: string): TaskRecord[] {
    const dependents: TaskRecord[] = [];
    for (const task of this.tasks.listTasks()) {
      const statements = task.compiledStatements;
      if (statements === undefined) {
        continue;
      }
      const names = collectVarNamesReferencedFromStatements(statements);
      if (names.has(varName)) {
        dependents.push(task);
      }
    }
    return dependents;
  }

  private findTasksDependingOnStateMachineRoot(machineName: string): TaskRecord[] {
    const dependents: TaskRecord[] = [];
    for (const task of this.tasks.listTasks()) {
      const membershipPath = task.stateMembershipPath;
      if (membershipPath !== undefined) {
        const firstSegment = membershipPath.split(".")[0];
        if (
          firstSegment === machineName ||
          membershipPath === machineName ||
          membershipPath.startsWith(`${machineName}.`)
        ) {
          dependents.push(task);
          continue;
        }
      }
      const statements = task.compiledStatements;
      if (statements === undefined) {
        continue;
      }
      const paths = collectStatePathTextsFromStatements(statements);
      for (const path of paths) {
        if (path === machineName || path.startsWith(`${machineName}.`)) {
          dependents.push(task);
          break;
        }
      }
    }
    return dependents;
  }

  private removeStateMachineRootByMachineName(machineName: string): boolean {
    const foundIndex = this.compiledStateMachines.findIndex((sm) => sm.machineName === machineName);
    if (foundIndex === -1) {
      return false;
    }
    const removedMachine = this.compiledStateMachines[foundIndex];
    if (removedMachine === undefined) {
      return false;
    }
    this.compiledStateMachines = this.compiledStateMachines.filter((sm) => sm.machineName !== machineName);
    this.compiledStateMachineNodeIndexByMachineName.delete(machineName);
    this.activeLeafPathByMachineName.delete(machineName);
    this.stateMachineTickAccumulatorMsByMachineName.delete(machineName);
    for (const node of removedMachine.nodes) {
      for (const prefixPath of enumerateDotPathPrefixes(node.path)) {
        this.statePathEntrySimulationMs.delete(prefixPath);
      }
    }
    return true;
  }
}

function scriptValueToConcreteArgument(value: ScriptValue | undefined): ConcreteMethodArgument | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.tag === "integer") {
    return { kind: "integer", value: value.value };
  }
  if (value.tag === "string") {
    return { kind: "string", value: value.value };
  }
  return undefined;
}

function buildCompiledStateMachineNodeIndex(
  nodes: CompiledStateMachineNodeIr[],
): Map<string, CompiledStateMachineNodeIr> {
  return new Map(nodes.map((node) => [node.path, node]));
}

function enumerateDotPathPrefixes(fullPath: string): string[] {
  const segments = fullPath.split(".");
  const prefixes: string[] = [];
  for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
    prefixes.push(segments.slice(0, segmentCount).join("."));
  }
  return prefixes;
}

function parentDotPath(path: string): string | undefined {
  const lastDotIndex = path.lastIndexOf(".");
  if (lastDotIndex === -1) {
    return undefined;
  }
  return path.slice(0, lastDotIndex);
}

function longestCommonDotPathPrefix(leftPath: string, rightPath: string): string {
  const leftSegments = leftPath.split(".");
  const rightSegments = rightPath.split(".");
  const commonSegments: string[] = [];
  const maximumSharedSegmentCount = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < maximumSharedSegmentCount; index += 1) {
    if (leftSegments[index] !== rightSegments[index]) {
      break;
    }
    commonSegments.push(leftSegments[index]);
  }
  return commonSegments.join(".");
}

function computeExitPathSequence(oldLeafPath: string, newLeafPath: string): string[] {
  const longestCommonPrefixPath = longestCommonDotPathPrefix(oldLeafPath, newLeafPath);
  const exitPaths: string[] = [];
  let cursorPath: string | undefined = oldLeafPath;
  while (cursorPath !== undefined && cursorPath !== longestCommonPrefixPath) {
    exitPaths.push(cursorPath);
    cursorPath = parentDotPath(cursorPath);
  }
  return exitPaths;
}

function computeEnterPathSequence(oldLeafPath: string | undefined, newLeafPath: string): string[] {
  if (oldLeafPath === undefined) {
    return enumerateDotPathPrefixes(newLeafPath);
  }
  if (oldLeafPath === newLeafPath) {
    return [];
  }
  const longestCommonPrefixPath = longestCommonDotPathPrefix(oldLeafPath, newLeafPath);
  const enterPaths: string[] = [];
  for (const path of enumerateDotPathPrefixes(newLeafPath)) {
    if (path === longestCommonPrefixPath) {
      continue;
    }
    if (path.length <= longestCommonPrefixPath.length) {
      continue;
    }
    if (longestCommonPrefixPath === "") {
      enterPaths.push(path);
      continue;
    }
    if (path.startsWith(`${longestCommonPrefixPath}.`)) {
      enterPaths.push(path);
    }
  }
  return enterPaths;
}
