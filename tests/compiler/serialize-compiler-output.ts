/**
 * Golden fixture 用にコンパイル結果を決定的なプレーン JSON へ直列化する。
 */

import type { CompileScriptResult } from "../../src/compiler/compiler-result";

export function serializeCompileScriptResultForGoldenTest(
  compileScriptResult: CompileScriptResult,
): unknown {
  if (compileScriptResult.ok === false) {
    return {
      ok: false,
      diagnostics: compileScriptResult.report.diagnostics.map((diagnostic) => ({
        id: diagnostic.id,
        phase: diagnostic.phase,
        message: diagnostic.message,
        location: diagnostic.location,
        expected: diagnostic.expected,
        actual: diagnostic.actual,
      })),
    };
  }

  return {
    ok: true,
      program: {
        stateInitializers: compileScriptResult.program.stateInitializers,
        animatorDefinitions: compileScriptResult.program.animatorDefinitions,
        everyTasks: compileScriptResult.program.everyTasks.map((everyTask) => ({
        taskName: everyTask.taskName,
        intervalMilliseconds: everyTask.intervalMilliseconds,
        statements: everyTask.statements,
      })),
      onEventTasks: compileScriptResult.program.onEventTasks.map((onTask) => ({
        taskName: onTask.taskName,
        deviceAddress: onTask.deviceAddress,
        eventName: onTask.eventName,
        statements: onTask.statements,
      })),
    },
  };
}
