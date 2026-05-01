/**
 * Golden fixture 用にコンパイル結果を決定的なプレーン JSON へ直列化する。
 */

import type { StructuredDiagnostic } from "../../src/diagnostics/diagnostic";
import type { CompileScriptResult } from "../../src/compiler/compiler-result";

function serializeStructuredDiagnosticForGolden(diagnostic: StructuredDiagnostic): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: diagnostic.id,
    phase: diagnostic.phase,
    message: diagnostic.message,
    location: diagnostic.location,
  };
  if (diagnostic.expected !== undefined) {
    row.expected = diagnostic.expected;
  }
  if (diagnostic.actual !== undefined) {
    row.actual = diagnostic.actual;
  }
  return row;
}

export function serializeCompileScriptResultForGoldenTest(
  compileScriptResult: CompileScriptResult,
): unknown {
  if (compileScriptResult.ok === false) {
    return {
      ok: false,
      diagnostics: compileScriptResult.report.diagnostics.map(serializeStructuredDiagnosticForGolden),
    };
  }

  return {
    ok: true,
    program: {
      varInitializers: compileScriptResult.program.varInitializers,
      constInitializers: compileScriptResult.program.constInitializers,
      stateMachines: compileScriptResult.program.stateMachines,
      animatorDefinitions: compileScriptResult.program.animatorDefinitions,
      everyTasks: compileScriptResult.program.everyTasks.map((everyTask) => {
        const row: Record<string, unknown> = {
          taskName: everyTask.taskName,
          intervalMilliseconds: everyTask.intervalMilliseconds,
          statements: everyTask.statements,
        };
        if (everyTask.stateMembershipPath !== undefined) {
          row.stateMembershipPath = everyTask.stateMembershipPath;
        }
        return row;
      }),
      onEventTasks: compileScriptResult.program.onEventTasks.map((onTask) => {
        const row: Record<string, unknown> = {
          taskName: onTask.taskName,
          triggerKind: onTask.triggerKind,
          statements: onTask.statements,
        };
        if (onTask.triggerKind === "device_event") {
          row.deviceAddress = onTask.deviceAddress;
          row.eventName = onTask.eventName;
        }
        if (onTask.stateMembershipPath !== undefined) {
          row.stateMembershipPath = onTask.stateMembershipPath;
        }
        return row;
      }),
      loopTasks: compileScriptResult.program.loopTasks.map((loopTask) => {
        const row: Record<string, unknown> = {
          taskName: loopTask.taskName,
          statements: loopTask.statements,
        };
        if (loopTask.stateMembershipPath !== undefined) {
          row.stateMembershipPath = loopTask.stateMembershipPath;
        }
        return row;
      }),
    },
  };
}
