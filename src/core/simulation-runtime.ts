import { DeviceBus } from "./device-bus";
import type { DeviceEffect } from "./device-bus";
import type { DefaultDevices } from "../devices/create-default-devices";
import { createDefaultDevices, registerDefaultDevices } from "../devices/create-default-devices";
import type { TaskRegistry } from "./task-registry";

export type SimulationTickResult = {
  appliedEffectCount: number;
};

/**
 * Applies queued effects on tick boundaries; advances cooperative every-tasks.
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
    const appliedEffectCount = this.flushPendingEffects();
    this.advanceEveryTasks(elapsedMilliseconds);
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
      }
    }
  }
}
