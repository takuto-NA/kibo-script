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
      stateMembershipPath: everyTask.stateMembershipPath,
      onEventTriggerKind: undefined,
      onEventFilter: undefined,
    });
  }

  for (const loopTask of params.compiledProgram.loopTasks) {
    params.taskRegistry.registerTask({
      name: loopTask.taskName,
      runMode: "loop",
      intervalMilliseconds: undefined,
      eventExpression: undefined,
      running: true,
      accumulatedMilliseconds: 0,
      body: "",
      compiledStatements: loopTask.statements,
      executionProgress: undefined,
      stateMembershipPath: loopTask.stateMembershipPath,
      onEventTriggerKind: undefined,
      onEventFilter: undefined,
    });
  }

  for (const onTask of params.compiledProgram.onEventTasks) {
    if (onTask.triggerKind === "device_event") {
      const deviceAddress = onTask.deviceAddress;
      const eventName = onTask.eventName;
      if (deviceAddress === undefined || eventName === undefined) {
        throw new Error('Invariant: device_event trigger requires deviceAddress and eventName.');
      }
      const addressKey = formatDeviceAddress(deviceAddress);
      params.taskRegistry.registerTask({
        name: onTask.taskName,
        runMode: "on_event",
        intervalMilliseconds: undefined,
        eventExpression: `${addressKey}.${eventName}`,
        running: true,
        accumulatedMilliseconds: 0,
        body: "",
        compiledStatements: onTask.statements,
        executionProgress: undefined,
        stateMembershipPath: onTask.stateMembershipPath,
        onEventTriggerKind: "device_event",
        onEventFilter: {
          deviceAddress,
          eventName,
        },
      });
      continue;
    }

    params.taskRegistry.registerTask({
      name: onTask.taskName,
      runMode: "on_event",
      intervalMilliseconds: undefined,
      eventExpression: undefined,
      running: true,
      accumulatedMilliseconds: 0,
      body: "",
      compiledStatements: onTask.statements,
      executionProgress: undefined,
      stateMembershipPath: onTask.stateMembershipPath,
      onEventTriggerKind: onTask.triggerKind,
      onEventFilter: undefined,
    });
  }
}
