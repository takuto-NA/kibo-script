/**
 * compileScript の結果を simulation の TaskRegistry に載せる（DOM に依存しない）。
 */

import { compileScript } from "../compiler/compile-script";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import type { SimulationRuntime } from "./simulation-runtime";
import { registerCompiledProgramOnTaskRegistry } from "./register-compiled-program";

export type CompileAndRegisterSimulationTasksResult =
  | { ok: true; registeredTaskNames: string[] }
  | { ok: false; report: DiagnosticReport };

export function compileSourceAndRegisterSimulationTasks(params: {
  sourceText: string;
  sourceFileName: string;
  simulationRuntime: SimulationRuntime;
}): CompileAndRegisterSimulationTasksResult {
  const compileResult = compileScript(params.sourceText, params.sourceFileName);
  if (compileResult.ok === false) {
    return { ok: false, report: compileResult.report };
  }

  registerCompiledProgramOnTaskRegistry({
    taskRegistry: params.simulationRuntime.tasks,
    compiledProgram: compileResult.program,
  });

  const registeredTaskNames = compileResult.program.everyTasks.map((everyTask) => everyTask.taskName);
  return { ok: true, registeredTaskNames };
}
