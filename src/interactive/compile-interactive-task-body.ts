/**
 * interactive shell の `task every { ... }` body を、tick 実行用 ExecutableStatement 列へ変換する。
 * `evaluateInteractiveCommand` は呼ばない（tick(0) の副作用を避ける）。
 * 各行は full compiler の `compileDoStatementSourceLineToExecutableStatement` と同一 IR を通す。
 */

import type { ExecutableStatement } from "../core/executable-task";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import { compileDoStatementSourceLineToExecutableStatement } from "../compiler/compile-do-statement-source-line";

export type CompileInteractiveTaskBodyResult =
  | { ok: true; executableStatements: ExecutableStatement[] }
  | { ok: false; report: DiagnosticReport };

export function compileInteractiveEveryTaskBodyToExecutableStatements(
  rawBodyText: string,
): CompileInteractiveTaskBodyResult {
  const executableStatements: ExecutableStatement[] = [];
  const bodyLines = rawBodyText.split("\n");

  for (const rawLine of bodyLines) {
    const trimmedLine = rawLine.trim();
    if (trimmedLine === "" || trimmedLine.startsWith("//")) {
      continue;
    }

    const compiledLine = compileDoStatementSourceLineToExecutableStatement({
      sourceLine: trimmedLine,
      fileName: "<interactive>",
    });
    if (compiledLine.ok === false) {
      return compiledLine;
    }

    executableStatements.push(compiledLine.executableStatement);
  }

  return { ok: true, executableStatements };
}
