/**
 * 意味論レベル: タスク名重複、タスク間隔 > 0、loop task の最低限の安全性。
 * single-writer は将来拡張用の空実装とする。
 */

import type { AstRange } from "../ast/script-ast";
import type { BoundProgram, BoundStatement } from "./bound-program";
import { convertAstRangeToSourceRange } from "./ast-range-to-source-range";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import {
  buildSemanticDuplicateTaskName,
  buildSemanticInvalidTaskInterval,
  buildSemanticLoopTaskRequiresWaitStatement,
} from "../diagnostics/diagnostic-builder";

export function semanticCheckBoundProgram(boundProgram: BoundProgram): DiagnosticReport {
  const diagnostics: DiagnosticReport["diagnostics"] = [];
  const taskNameToFirstDeclarationRange = new Map<string, AstRange>();

  for (const task of boundProgram.everyTasks) {
    const firstDeclarationRange = taskNameToFirstDeclarationRange.get(task.taskName);
    if (firstDeclarationRange !== undefined) {
      diagnostics.push(
        buildSemanticDuplicateTaskName({
          name: task.taskName,
          range: convertAstRangeToSourceRange(task.range),
          related: [
            {
              message: "Earlier task declared here.",
              location: convertAstRangeToSourceRange(firstDeclarationRange),
            },
          ],
        }),
      );
      continue;
    }
    taskNameToFirstDeclarationRange.set(task.taskName, task.range);

    if (task.intervalUnit === "ms" && task.intervalValue <= 0) {
      diagnostics.push(
        buildSemanticInvalidTaskInterval({
          message: "Task interval must be greater than zero milliseconds.",
          range: convertAstRangeToSourceRange(task.intervalRange),
        }),
      );
    }
  }

  for (const task of boundProgram.loopTasks) {
    const firstDeclarationRange = taskNameToFirstDeclarationRange.get(task.taskName);
    if (firstDeclarationRange !== undefined) {
      diagnostics.push(
        buildSemanticDuplicateTaskName({
          name: task.taskName,
          range: convertAstRangeToSourceRange(task.range),
          related: [
            {
              message: "Earlier task declared here.",
              location: convertAstRangeToSourceRange(firstDeclarationRange),
            },
          ],
        }),
      );
      continue;
    }
    taskNameToFirstDeclarationRange.set(task.taskName, task.range);

    if (!boundStatementSequenceContainsWaitStatement(task.statements)) {
      diagnostics.push(
        buildSemanticLoopTaskRequiresWaitStatement({
          taskName: task.taskName,
          range: convertAstRangeToSourceRange(task.range),
        }),
      );
    }
  }

  for (const task of boundProgram.onEventTasks) {
    const firstDeclarationRange = taskNameToFirstDeclarationRange.get(task.taskName);
    if (firstDeclarationRange !== undefined) {
      diagnostics.push(
        buildSemanticDuplicateTaskName({
          name: task.taskName,
          range: convertAstRangeToSourceRange(task.range),
          related: [
            {
              message: "Earlier task declared here.",
              location: convertAstRangeToSourceRange(firstDeclarationRange),
            },
          ],
        }),
      );
      continue;
    }
    taskNameToFirstDeclarationRange.set(task.taskName, task.range);
  }

  return createDiagnosticReport(diagnostics);
}

function boundStatementSequenceContainsWaitStatement(statements: BoundStatement[]): boolean {
  for (const statement of statements) {
    if (boundStatementTreeContainsWaitStatement(statement)) {
      return true;
    }
  }
  return false;
}

function boundStatementTreeContainsWaitStatement(statement: BoundStatement): boolean {
  if (statement.kind === "wait_statement") {
    return true;
  }

  if (statement.kind === "if_statement") {
    if (boundStatementSequenceContainsWaitStatement(statement.thenStatements)) {
      return true;
    }
    return boundStatementSequenceContainsWaitStatement(statement.elseStatements);
  }

  if (statement.kind === "match_statement") {
    // ガード: match 分岐内 wait は言語版により禁止。loop の「wait 必須」判定から除外する。
    return false;
  }

  return false;
}

/**
 * single-writer 規則の本実装は Phase 1 以降。Phase 0 では検査を行わない。
 */
export function runSingleWriterSkeletonCheck(_boundProgram: BoundProgram): DiagnosticReport {
  return createDiagnosticReport([]);
}
