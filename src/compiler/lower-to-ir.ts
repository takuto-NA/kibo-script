/**
 * バインド済み AST を SimulationRuntime が実行する CompiledProgram（IR）へ下げる。
 */

import type { BoundProgram } from "./bound-program";
import type { CompiledProgram } from "../core/executable-task";

export function lowerBoundProgramToCompiledProgram(boundProgram: BoundProgram): CompiledProgram {
  return {
    everyTasks: boundProgram.tasks.map((task) => ({
      taskName: task.taskName,
      intervalMilliseconds: task.intervalValue,
      statements: task.statements.map((statement) => ({
        kind: "do_method_call" as const,
        deviceAddress: statement.deviceAddress,
        methodName: statement.methodName,
        arguments: statement.arguments.map((argument) =>
          argument.kind === "integer"
            ? ({ kind: "integer" as const, value: argument.value })
            : ({ kind: "string" as const, value: argument.value }),
        ),
      })),
    })),
  };
}
