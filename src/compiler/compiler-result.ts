import type { DiagnosticReport } from "../diagnostics/diagnostic";
import type { CompiledProgram } from "../core/executable-task";

/**
 * Result of compiling a StaticCore Script source file.
 */
export type CompileScriptSuccess = {
  ok: true;
  program: CompiledProgram;
};

export type CompileScriptFailure = {
  ok: false;
  report: DiagnosticReport;
};

export type CompileScriptResult = CompileScriptSuccess | CompileScriptFailure;
