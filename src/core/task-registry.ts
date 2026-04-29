/**
 * Registered cooperative tasks（interactive の raw body と compiler の compiledStatements を保持）。
 */

import type { DeviceAddress } from "./device-address";
import type { ExecutableStatement } from "./executable-task";

export type TaskRunMode = "every" | "on_event" | "loop";

export type TaskExecutionProgress = {
  programCounter: number;
  resumeAtTotalMilliseconds: number | undefined;
};

export type TaskRecord = {
  name: string;
  runMode: TaskRunMode;
  intervalMilliseconds?: number;
  eventExpression?: string;
  running: boolean;
  /** Accumulated time since last fire for every-tasks. */
  accumulatedMilliseconds: number;
  /** Raw body text inside braces（interactive / shell 用）。 */
  body: string;
  /** Compiler が生成したタスク本体（full compiler 経路）。未設定なら every tick で実行しない。 */
  compiledStatements?: ExecutableStatement[];
  /** Task 実行内の `temp`（wait をまたぐ実行でも同一マップを維持）。PC==0 でクリア。 */
  taskLocalValues?: Map<string, number | string>;
  /** every task の wait 再開用。 */
  executionProgress?: TaskExecutionProgress;
  /** runMode === on_event のときのフィルタ。 */
  onEventFilter?: {
    deviceAddress: DeviceAddress;
    eventName: string;
  };
};

export class TaskRegistry {
  private readonly tasks: Map<string, TaskRecord> = new Map();

  public registerTask(record: TaskRecord): void {
    this.tasks.set(record.name, record);
  }

  public getTask(name: string): TaskRecord | undefined {
    return this.tasks.get(name);
  }

  public listTasks(): TaskRecord[] {
    return [...this.tasks.values()];
  }

  public removeTask(name: string): boolean {
    return this.tasks.delete(name);
  }

  public clearAllTasks(): void {
    this.tasks.clear();
  }

  public startTask(name: string): boolean {
    const task = this.tasks.get(name);
    if (task === undefined) {
      return false;
    }
    task.running = true;
    task.accumulatedMilliseconds = 0;
    return true;
  }

  public stopTask(name: string): boolean {
    const task = this.tasks.get(name);
    if (task === undefined) {
      return false;
    }
    task.running = false;
    return true;
  }
}
