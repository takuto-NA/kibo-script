/**
 * StaticCore Script をコンパイルし、runtime 用 IR（CompiledProgram）または診断レポートを返す。
 */

import type { CompileScriptResult } from "./compiler-result";
import { bindProgram } from "./binder";
import { lowerBoundProgramToCompiledProgram } from "./lower-to-ir";
import { lexSourceText } from "./lexer";
import { parseProgram } from "./parser";
import { semanticCheckBoundProgram } from "./semantic-checker";
import { typeCheckBoundProgram } from "./type-checker";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import { buildCompilerEmptyScript } from "../diagnostics/diagnostic-builder";

export function compileScript(sourceText: string, fileName: string): CompileScriptResult {
  if (sourceText.trim().length === 0) {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildCompilerEmptyScript({
          file: fileName,
        }),
      ]),
    };
  }

  const lexResult = lexSourceText(sourceText, fileName);
  if (lexResult.ok === false) {
    return { ok: false, report: lexResult.report };
  }

  const parseResult = parseProgram(lexResult.tokens, fileName);
  if (parseResult.ok === false) {
    return { ok: false, report: parseResult.report };
  }

  if (parseResult.ast.declarations.length === 0) {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildCompilerEmptyScript({
          file: fileName,
        }),
      ]),
    };
  }

  const bindResult = bindProgram(parseResult.ast, fileName);
  if (bindResult.ok === false) {
    return { ok: false, report: bindResult.report };
  }

  const typeReport = typeCheckBoundProgram(bindResult.boundProgram);
  if (typeReport.diagnostics.length > 0) {
    return { ok: false, report: typeReport };
  }

  const semanticReport = semanticCheckBoundProgram(bindResult.boundProgram);
  if (semanticReport.diagnostics.length > 0) {
    return { ok: false, report: semanticReport };
  }

  const compiledProgram = lowerBoundProgramToCompiledProgram(bindResult.boundProgram);
  return { ok: true, program: compiledProgram };
}
