/**
 * compileScript の結果を simulation の TaskRegistry に載せる（DOM に依存しない）。
 */

import { compileScriptAgainstRuntimeWorld } from "../compiler/compile-script-against-runtime-world";
import { compileScript } from "../compiler/compile-script";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import type { CompiledProgram } from "./executable-task";
import type { SimulationRuntime } from "./simulation-runtime";

export type SimulationScriptRegistrationMode = "reset" | "add";

export type CompileAndRegisterSimulationTasksResult =
  | { ok: true; registeredTaskNames: string[]; compiledProgram: CompiledProgram }
  | { ok: false; report: DiagnosticReport };

export function compileSourceAndRegisterSimulationTasks(params: {
  sourceText: string;
  sourceFileName: string;
  simulationRuntime: SimulationRuntime;
  registrationMode?: SimulationScriptRegistrationMode;
}): CompileAndRegisterSimulationTasksResult {
  const registrationMode = params.registrationMode ?? "reset";

  if (registrationMode === "add") {
    const compileResult = compileScriptAgainstRuntimeWorld(
      params.sourceText,
      params.sourceFileName,
      params.simulationRuntime,
    );
    if (compileResult.ok === false) {
      return { ok: false, report: compileResult.report };
    }

    const additiveResult = params.simulationRuntime.tryRegisterCompiledProgramAdditive(compileResult.program);
    if (additiveResult.ok === false) {
      return { ok: false, report: additiveResult.report };
    }

    const everyNames = compileResult.program.everyTasks.map((everyTask) => everyTask.taskName);
    const loopNames = compileResult.program.loopTasks.map((loopTask) => loopTask.taskName);
    const onEventNames = compileResult.program.onEventTasks.map((task) => task.taskName);
    const registeredTaskNames = [...everyNames, ...loopNames, ...onEventNames];
    return { ok: true, registeredTaskNames, compiledProgram: compileResult.program };
  }

  const compileResult = compileScript(params.sourceText, params.sourceFileName);
  if (compileResult.ok === false) {
    return { ok: false, report: compileResult.report };
  }

  params.simulationRuntime.replaceCompiledProgram(compileResult.program);

  const everyNames = compileResult.program.everyTasks.map((everyTask) => everyTask.taskName);
  const loopNames = compileResult.program.loopTasks.map((loopTask) => loopTask.taskName);
  const onEventNames = compileResult.program.onEventTasks.map((task) => task.taskName);
  const registeredTaskNames = [...everyNames, ...loopNames, ...onEventNames];
  return { ok: true, registeredTaskNames, compiledProgram: compileResult.program };
}
