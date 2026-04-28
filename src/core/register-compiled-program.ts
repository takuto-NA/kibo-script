/**
 * CompiledProgram を TaskRegistry に登録し、SimulationRuntime の every tick で実行可能にする。
 */

import type { CompiledProgram } from "./executable-task";
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
    });
  }
}
