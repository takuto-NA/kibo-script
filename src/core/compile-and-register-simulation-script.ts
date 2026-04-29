/**
 * compileScript の結果を simulation の TaskRegistry に載せる（DOM に依存しない）。
 */

import { compileScript } from "../compiler/compile-script";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import type { SimulationRuntime } from "./simulation-runtime";
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

  params.simulationRuntime.replaceCompiledProgram(compileResult.program);

  const everyNames = compileResult.program.everyTasks.map((everyTask) => everyTask.taskName);
  const loopNames = compileResult.program.loopTasks.map((loopTask) => loopTask.taskName);
  const onEventNames = compileResult.program.onEventTasks.map((task) => task.taskName);
  const registeredTaskNames = [...everyNames, ...loopNames, ...onEventNames];
  return { ok: true, registeredTaskNames };
}
