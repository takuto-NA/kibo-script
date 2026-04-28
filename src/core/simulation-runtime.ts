import { DeviceBus } from "./device-bus";
import type { DeviceEffect } from "./device-bus";
import { mapExecutableStatementToDeviceEffects } from "./executable-statement-to-device-effects";
import type { DefaultDevices } from "../devices/create-default-devices";
import { createDefaultDevices, registerDefaultDevices } from "../devices/create-default-devices";
import type { TaskRecord, TaskRegistry } from "./task-registry";

export type SimulationTickResult = {
  appliedEffectCount: number;
};

/**
 * cooperative every-task の時間を進め、コンパイル済みタスク本体から DeviceEffect を生成してキューへ積む。
 */
export class SimulationRuntime {
  private readonly deviceBus: DeviceBus;
  private readonly pendingEffects: DeviceEffect[] = [];
  private readonly internalDevices: DefaultDevices;
  public readonly tasks: TaskRegistry;

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

  public queueEffect(effect: DeviceEffect): void {
    this.pendingEffects.push(effect);
  }

  public queueEffects(effects: DeviceEffect[]): void {
    this.pendingEffects.push(...effects);
  }

  public tick(elapsedMilliseconds: number): SimulationTickResult {
    this.advanceEveryTasks(elapsedMilliseconds);
    const appliedEffectCount = this.flushPendingEffects();
    return { appliedEffectCount };
  }

  private flushPendingEffects(): number {
    const count = this.pendingEffects.length;
    for (const effect of this.pendingEffects) {
      this.deviceBus.applyEffect(effect);
    }
    this.pendingEffects.length = 0;
    return count;
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
        this.enqueueCompiledTaskEffects(task);
      }
    }
  }

  private enqueueCompiledTaskEffects(task: TaskRecord): void {
    const statements = task.compiledStatements;
    if (statements === undefined) {
      return;
    }
    for (const statement of statements) {
      const deviceEffects = mapExecutableStatementToDeviceEffects(statement);
      this.queueEffects(deviceEffects);
    }
  }
}
