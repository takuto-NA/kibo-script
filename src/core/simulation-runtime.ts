import { DeviceBus } from "./device-bus";
import type { DeviceEffect } from "./device-bus";
import type { DeviceAddress } from "./device-address";
import {
  mapDoMethodCallToDeviceEffects,
  type ConcreteMethodArgument,
} from "./executable-statement-to-device-effects";
import type { CompiledAnimatorDefinition, CompiledProgram } from "./executable-task";
import type { ExecutableStatement } from "./executable-task";
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
import type { ScriptValue } from "./value";
import type { TaskRecord, TaskRegistry } from "./task-registry";

export type SimulationTickResult = {
  appliedEffectCount: number;
};

export type DeviceEffectAppliedListener = (effect: DeviceEffect) => void;

/**
 * cooperative every-task / on_event の時間とプログラムカウンタを進め、DeviceEffect をキューへ積む。
 */
export class SimulationRuntime {
  private readonly deviceBus: DeviceBus;
  private readonly pendingEffects: DeviceEffect[] = [];
  private readonly internalDevices: DefaultDevices;
  public readonly tasks: TaskRegistry;
  private totalSimulationMilliseconds = 0;
  private readonly scriptStateValues = new Map<string, number | string>();
  private readonly scriptConstValues = new Map<string, number | string>();
  private compiledAnimatorDefinitionsByName = new Map<string, CompiledAnimatorDefinition>();
  private readonly animatorRuntimeStatesByName = new Map<string, AnimatorRuntimeState>();
  private readonly onAfterDeviceEffectApplied?: DeviceEffectAppliedListener;

  public constructor(params: {
    deviceBus?: DeviceBus;
    devices?: DefaultDevices;
    tasks: TaskRegistry;
    onAfterDeviceEffectApplied?: DeviceEffectAppliedListener;
  }) {
    this.deviceBus = params.deviceBus ?? new DeviceBus();
    this.internalDevices = params.devices ?? createDefaultDevices();
    this.tasks = params.tasks;
    this.onAfterDeviceEffectApplied = params.onAfterDeviceEffectApplied;
    registerDefaultDevices((address, device) => {
      this.deviceBus.registerDevice(address, device);
    }, this.internalDevices);
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

  public getScriptStateValues(): ReadonlyMap<string, number | string> {
    return this.scriptStateValues;
  }

  /**
   * 登録済み task を破棄し、CompiledProgram の state 初期化と task 再登録を行う。
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
    registerCompiledProgramOnTaskRegistry({
      taskRegistry: this.tasks,
      compiledProgram,
    });
  }

  private initializeScriptStateFromCompiledProgram(compiledProgram: CompiledProgram): void {
    this.scriptStateValues.clear();
    this.scriptConstValues.clear();
    const evaluationContextBase = this.createEvaluationContextForStateInitialization();
    for (const initializer of compiledProgram.stateInitializers) {
      const scriptValue = evaluateExecutableExpression(initializer.expression, evaluationContextBase);
      if (scriptValue === undefined) {
        continue;
      }
      if (scriptValue.tag === "integer") {
        this.scriptStateValues.set(initializer.stateName, scriptValue.value);
        continue;
      }
      if (scriptValue.tag === "string") {
        this.scriptStateValues.set(initializer.stateName, scriptValue.value);
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
    this.resumeWaitingEveryTasks();
    this.advanceEveryTasks(elapsedMilliseconds);
    const appliedEffectCount = this.flushPendingEffects();
    return { appliedEffectCount };
  }

  private createEvaluationContextForStateInitialization(): EvaluateExecutableExpressionContext {
    return {
      deviceBus: this.deviceBus,
      stateValues: this.scriptStateValues,
      constValues: this.scriptConstValues,
    };
  }

  private createEvaluationContextForTask(task: TaskRecord): EvaluateExecutableExpressionContext {
    if (task.taskLocalValues === undefined) {
      task.taskLocalValues = new Map();
    }
    return {
      deviceBus: this.deviceBus,
      stateValues: this.scriptStateValues,
      constValues: this.scriptConstValues,
      tempValues: task.taskLocalValues,
      taskExecution: {
        runMode: task.runMode,
        nominalIntervalMilliseconds: task.intervalMilliseconds,
      },
      animatorDefinitionsByName: this.compiledAnimatorDefinitionsByName,
      animatorRuntimeStatesByName: this.animatorRuntimeStatesByName,
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

  private resumeWaitingEveryTasks(): void {
    for (const task of this.tasks.listTasks()) {
      if (!task.running || task.runMode !== "every") {
        continue;
      }
      const progress = task.executionProgress;
      if (progress === undefined || progress.resumeAtTotalMilliseconds === undefined) {
        continue;
      }
      if (this.totalSimulationMilliseconds < progress.resumeAtTotalMilliseconds) {
        continue;
      }
      progress.resumeAtTotalMilliseconds = undefined;
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
        task.executionProgress = {
          programCounter: 0,
          resumeAtTotalMilliseconds: undefined,
        };
        this.drainTaskExecution(task);
      }
    }
  }

  private drainTaskExecution(task: TaskRecord): void {
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

    while (task.executionProgress.programCounter < statements.length) {
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
        task.executionProgress.resumeAtTotalMilliseconds =
          this.totalSimulationMilliseconds + statement.waitMilliseconds;
        task.executionProgress.programCounter = programCounter + 1;
        return;
      }

      if (statement.kind === "assign_state") {
        this.executeAssignStateStatement(statement, task);
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

      if (innerStatement.kind === "assign_state") {
        this.executeAssignStateStatement(innerStatement, task);
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

  private executeAssignStateStatement(
    statement: ExecutableStatement & { kind: "assign_state" },
    task: TaskRecord,
  ): void {
    const evaluationContext = this.createEvaluationContextForTask(task);
    const scriptValue = evaluateExecutableExpression(statement.valueExpression, evaluationContext);
    if (scriptValue === undefined) {
      return;
    }
    if (scriptValue.tag === "integer") {
      this.scriptStateValues.set(statement.stateName, scriptValue.value);
      return;
    }
    if (scriptValue.tag === "string") {
      this.scriptStateValues.set(statement.stateName, scriptValue.value);
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
