/**
 * 意味論レベル: タスク名重複、タスク間隔 > 0。single-writer は将来拡張用の空実装とする。
 */

import type { AstRange } from "../ast/script-ast";
import type { BoundProgram } from "./bound-program";
import { convertAstRangeToSourceRange } from "./ast-range-to-source-range";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import { buildSemanticDuplicateTaskName, buildSemanticInvalidTaskInterval } from "../diagnostics/diagnostic-builder";

export function semanticCheckBoundProgram(boundProgram: BoundProgram): DiagnosticReport {
  const diagnostics: DiagnosticReport["diagnostics"] = [];
  const taskNameToFirstDeclarationRange = new Map<string, AstRange>();

  for (const task of boundProgram.tasks) {
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

/**
 * single-writer 規則の本実装は Phase 1 以降。Phase 0 では検査を行わない。
 */
export function runSingleWriterSkeletonCheck(_boundProgram: BoundProgram): DiagnosticReport {
  return createDiagnosticReport([]);
}
