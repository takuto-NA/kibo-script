import { DeviceBus } from "./device-bus";
import type { DeviceEffect } from "./device-bus";
import type { DeviceAddress } from "./device-address";
import {
  mapDoMethodCallToDeviceEffects,
  type ConcreteMethodArgument,
} from "./executable-statement-to-device-effects";
import type { CompiledProgram } from "./executable-task";
import type { ExecutableStatement } from "./executable-task";
import {
  evaluateExecutableExpression,
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

  public constructor(params: {
    deviceBus?: DeviceBus;
    devices?: DefaultDevices;
    tasks: TaskRegistry;
  }) {
    this.deviceBus = params.deviceBus ?? new DeviceBus();
    this.internalDevices = params.devices ?? createDefaultDevices();
    this.tasks = params.tasks;
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
    this.tasks.clearAllTasks();
    this.initializeScriptStateFromCompiledProgram(compiledProgram);
    registerCompiledProgramOnTaskRegistry({
      taskRegistry: this.tasks,
      compiledProgram,
    });
  }

  private initializeScriptStateFromCompiledProgram(compiledProgram: CompiledProgram): void {
    this.scriptStateValues.clear();
    const evaluationContext = this.createEvaluationContext();
    for (const initializer of compiledProgram.stateInitializers) {
      const scriptValue = evaluateExecutableExpression(initializer.expression, evaluationContext);
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

  private createEvaluationContext(): EvaluateExecutableExpressionContext {
    return {
      deviceBus: this.deviceBus,
      stateValues: this.scriptStateValues,
    };
  }

  private flushPendingEffects(): number {
    const count = this.pendingEffects.length;
    for (const effect of this.pendingEffects) {
      this.deviceBus.applyEffect(effect);
    }
    this.pendingEffects.length = 0;
    return count;
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
      const statement = statements[programCounter];

      if (statement.kind === "wait_milliseconds") {
        task.executionProgress.resumeAtTotalMilliseconds =
          this.totalSimulationMilliseconds + statement.waitMilliseconds;
        task.executionProgress.programCounter = programCounter + 1;
        return;
      }

      if (statement.kind === "assign_state") {
        this.executeAssignStateStatement(statement);
        task.executionProgress.programCounter = programCounter + 1;
        continue;
      }

      if (statement.kind === "do_method_call") {
        const effects = this.effectsForDoMethodCall(statement);
        this.queueEffects(effects);
        task.executionProgress.programCounter = programCounter + 1;
        continue;
      }
    }

    task.executionProgress = undefined;
  }

  private executeAssignStateStatement(
    statement: ExecutableStatement & { kind: "assign_state" },
  ): void {
    const evaluationContext = this.createEvaluationContext();
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
  ): DeviceEffect[] {
    const evaluationContext = this.createEvaluationContext();

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
