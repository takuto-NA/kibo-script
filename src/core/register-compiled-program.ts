/**
 * CompiledProgram を TaskRegistry に登録し、SimulationRuntime の tick で実行可能にする。
 */

import type { CompiledProgram } from "./executable-task";
import { formatDeviceAddress } from "./device-address";
import type { TaskRegistry } from "./task-registry";

export function registerCompiledProgramOnTaskRegistry(params: {
  taskRegistry: TaskRegistry;
  compiledProgram: CompiledProgram;
}): void {
  for (const everyTask of params.compiledProgram.everyTasks) {
    params.taskRegistry.registerTask({
      name: everyTask.taskName,
      runMode: "every",
      intervalMilliseconds: everyTask.intervalMilliseconds,
      eventExpression: undefined,
      running: true,
      accumulatedMilliseconds: 0,
      body: "",
      compiledStatements: everyTask.statements,
      executionProgress: undefined,
      onEventFilter: undefined,
    });
  }

  for (const onTask of params.compiledProgram.onEventTasks) {
    const addressKey = formatDeviceAddress(onTask.deviceAddress);
    params.taskRegistry.registerTask({
      name: onTask.taskName,
      runMode: "on_event",
      intervalMilliseconds: undefined,
      eventExpression: `${addressKey}.${onTask.eventName}`,
      running: true,
      accumulatedMilliseconds: 0,
      body: "",
      compiledStatements: onTask.statements,
      executionProgress: undefined,
      onEventFilter: {
        deviceAddress: onTask.deviceAddress,
        eventName: onTask.eventName,
      },
    });
  }
}
