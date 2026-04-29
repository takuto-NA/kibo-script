/**
 * interactive shell の 1 行 `do ...` を full compiler pipeline で ExecutableStatement に変換する。
 */

import type { DoStatementAst, ProgramAst, TaskDeclarationAst } from "../ast/script-ast";
import { bindProgram } from "./binder";
import { lexSourceText } from "./lexer";
import { lowerBoundStatementToExecutableStatement } from "./lower-to-ir";
import { parseDoStatementLine } from "./parser";
import { semanticCheckBoundProgram } from "./semantic-checker";
import { typeCheckBoundProgram } from "./type-checker";
import type { ExecutableStatement } from "../core/executable-task";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import { buildParseUnsupportedSyntax } from "../diagnostics/diagnostic-builder";

export type CompileDoStatementSourceLineResult =
  | { ok: true; executableStatement: ExecutableStatement }
  | { ok: false; report: DiagnosticReport };

export function compileDoStatementSourceLineToExecutableStatement(params: {
  sourceLine: string;
  fileName: string;
}): CompileDoStatementSourceLineResult {
  const trimmedLine = params.sourceLine.trim();

  const lexResult = lexSourceText(trimmedLine, params.fileName);
  if (lexResult.ok === false) {
    return { ok: false, report: lexResult.report };
  }

  const parseResult = parseDoStatementLine(lexResult.tokens, params.fileName);
  if (parseResult.ok === false) {
    return { ok: false, report: parseResult.report };
  }

  const syntheticProgram = wrapSingleDoStatementInMinimalProgram(parseResult.doStatement, params.fileName);

  const bindResult = bindProgram(syntheticProgram, params.fileName);
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

  const firstTask = bindResult.boundProgram.everyTasks[0];
  const firstStatement = firstTask?.statements[0];
  if (firstStatement === undefined || firstStatement.kind !== "do_statement") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnsupportedSyntax({
          file: params.fileName,
          message: "Internal compiler error: expected a single do statement after binding.",
        }),
      ]),
    };
  }

  return {
    ok: true,
    executableStatement: lowerBoundStatementToExecutableStatement(firstStatement),
  };
}

function wrapSingleDoStatementInMinimalProgram(doStatement: DoStatementAst, _fileName: string): ProgramAst {
  const taskDeclaration: TaskDeclarationAst = {
    kind: "task_declaration",
    range: doStatement.range,
    taskName: "__interactive_do_line",
    schedule: {
      kind: "every",
      intervalValue: 1,
      intervalUnit: "ms",
      intervalRange: doStatement.range,
    },
    bodyStatements: [doStatement],
  };

  return {
    kind: "program",
    range: doStatement.range,
    declarations: [taskDeclaration],
  };
}
