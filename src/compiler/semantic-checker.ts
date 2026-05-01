/**
 * 意味論レベル: タスク名重複、タスク間隔、loop wait、状態機械 task 整合、var 単一ライター。
 */

import type { AstRange } from "../ast/script-ast";
import type { BoundExpression, BoundMatchPattern, BoundProgram, BoundStatement, BoundTaskStateMembership } from "./bound-program";
import { convertAstRangeToSourceRange } from "./ast-range-to-source-range";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import {
  buildSemanticDuplicateTaskName,
  buildSemanticInvalidTaskInterval,
  buildSemanticLoopTaskRequiresWaitStatement,
  buildSemanticUnknownStateElapsedPath,
  buildSemanticUnknownStateMembershipPath,
  buildSemanticLifecycleRequiresStateMembership,
  buildOwnershipMultipleWriters,
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

  const knownStatePathPrefixes = buildKnownStatePathPrefixSet(boundProgram);
  collectStateMembershipPathDiagnostics(boundProgram, knownStatePathPrefixes, diagnostics);
  collectStateElapsedPathDiagnostics(boundProgram, knownStatePathPrefixes, diagnostics);
  collectLifecycleMembershipDiagnostics(boundProgram, diagnostics);
  collectVarSingleWriterDiagnostics(boundProgram, diagnostics);

  return createDiagnosticReport(diagnostics);
}

function enumerateDotPathPrefixes(fullPath: string): string[] {
  const segments = fullPath.split(".");
  const prefixes: string[] = [];
  for (let index = 1; index <= segments.length; index += 1) {
    prefixes.push(segments.slice(0, index).join("."));
  }
  return prefixes;
}

function buildKnownStatePathPrefixSet(boundProgram: BoundProgram): Set<string> {
  const prefixes = new Set<string>();
  for (const stateMachine of boundProgram.stateMachinesInSourceOrder) {
    for (const nodePath of stateMachine.nodesByPath.keys()) {
      for (const prefix of enumerateDotPathPrefixes(nodePath)) {
        prefixes.add(prefix);
      }
    }
  }
  return prefixes;
}

function collectStateMembershipPathDiagnostics(
  boundProgram: BoundProgram,
  knownPrefixes: Set<string>,
  diagnostics: DiagnosticReport["diagnostics"],
): void {
  const reportMembership = (membership: BoundTaskStateMembership, declarationRange: AstRange) => {
    if (membership.kind === "none") {
      return;
    }
    if (!knownPrefixes.has(membership.statePathText)) {
      diagnostics.push(
        buildSemanticUnknownStateMembershipPath({
          path: membership.statePathText,
          range: convertAstRangeToSourceRange(membership.range),
        }),
      );
    }
  };

  for (const task of boundProgram.everyTasks) {
    reportMembership(task.stateMembership, task.range);
  }
  for (const task of boundProgram.loopTasks) {
    reportMembership(task.stateMembership, task.range);
  }
  for (const task of boundProgram.onEventTasks) {
    reportMembership(task.stateMembership, task.range);
  }
}

function collectLifecycleMembershipDiagnostics(
  boundProgram: BoundProgram,
  diagnostics: DiagnosticReport["diagnostics"],
): void {
  for (const task of boundProgram.onEventTasks) {
    if (task.trigger.kind !== "state_lifecycle") {
      continue;
    }
    if (task.stateMembership.kind !== "none") {
      continue;
    }
    diagnostics.push(
      buildSemanticLifecycleRequiresStateMembership({
        range: convertAstRangeToSourceRange(task.range),
      }),
    );
  }
}

function collectStateElapsedPathDiagnostics(
  boundProgram: BoundProgram,
  knownPrefixes: Set<string>,
  diagnostics: DiagnosticReport["diagnostics"],
): void {
  const reportExpression = (expression: BoundExpression) => {
    for (const elapsedReference of collectStateElapsedReferencesFromExpression(expression)) {
      if (knownPrefixes.has(elapsedReference.statePathText)) {
        continue;
      }
      diagnostics.push(
        buildSemanticUnknownStateElapsedPath({
          path: elapsedReference.statePathText,
          range: convertAstRangeToSourceRange(elapsedReference.range),
        }),
      );
    }
  };

  for (const stateMachine of boundProgram.stateMachinesInSourceOrder) {
    for (const transition of stateMachine.machineGlobalTransitions) {
      reportExpression(transition.condition);
    }
    for (const [, node] of stateMachine.nodesByPath) {
      for (const transition of node.localTransitions) {
        reportExpression(transition.condition);
      }
    }
  }

  for (const task of boundProgram.everyTasks) {
    collectExpressionsFromStatements(task.statements).forEach(reportExpression);
  }
  for (const task of boundProgram.loopTasks) {
    collectExpressionsFromStatements(task.statements).forEach(reportExpression);
  }
  for (const task of boundProgram.onEventTasks) {
    collectExpressionsFromStatements(task.statements).forEach(reportExpression);
  }
}

function collectVarSingleWriterDiagnostics(
  boundProgram: BoundProgram,
  diagnostics: DiagnosticReport["diagnostics"],
): void {
  const varNameToOwningTaskName = new Map<string, string>();
  const conflictingVarNames = new Set<string>();

  const recordAssignmentsForTask = (taskName: string, statements: BoundStatement[]) => {
    for (const varName of collectAssignedVarNamesFromStatements(statements)) {
      const existingOwnerTaskName = varNameToOwningTaskName.get(varName);
      if (existingOwnerTaskName === undefined) {
        varNameToOwningTaskName.set(varName, taskName);
        continue;
      }
      if (existingOwnerTaskName !== taskName && !conflictingVarNames.has(varName)) {
        conflictingVarNames.add(varName);
        diagnostics.push(
          buildOwnershipMultipleWriters({
            message: `Variable "${varName}" is assigned by more than one task ("${existingOwnerTaskName}" and "${taskName}").`,
          }),
        );
      }
    }
  };

  for (const task of boundProgram.everyTasks) {
    recordAssignmentsForTask(task.taskName, task.statements);
  }
  for (const task of boundProgram.loopTasks) {
    recordAssignmentsForTask(task.taskName, task.statements);
  }
  for (const task of boundProgram.onEventTasks) {
    recordAssignmentsForTask(task.taskName, task.statements);
  }
}

function collectAssignedVarNamesFromStatements(statements: BoundStatement[]): Set<string> {
  const names = new Set<string>();

  function walk(statementList: BoundStatement[]): void {
    for (const statement of statementList) {
      if (statement.kind === "set_statement") {
        names.add(statement.varName);
        continue;
      }
      if (statement.kind === "if_statement") {
        walk(statement.thenStatements);
        walk(statement.elseStatements);
        continue;
      }
      if (statement.kind === "match_statement") {
        for (const stringCase of statement.stringCases) {
          walk(stringCase.statements);
        }
        walk(statement.elseStatements);
      }
    }
  }

  walk(statements);
  return names;
}

function collectExpressionsFromStatements(statements: BoundStatement[]): BoundExpression[] {
  const expressions: BoundExpression[] = [];

  function walk(statementList: BoundStatement[]): void {
    for (const statement of statementList) {
      if (statement.kind === "do_statement") {
        expressions.push(...statement.arguments);
        continue;
      }
      if (statement.kind === "set_statement") {
        expressions.push(statement.valueExpression);
        continue;
      }
      if (statement.kind === "wait_statement") {
        expressions.push(statement.durationMillisecondsExpression);
        continue;
      }
      if (statement.kind === "temp_statement") {
        expressions.push(statement.valueExpression);
        continue;
      }
      if (statement.kind === "if_statement") {
        expressions.push(statement.conditionExpression);
        walk(statement.thenStatements);
        walk(statement.elseStatements);
        continue;
      }
      if (statement.kind === "match_statement") {
        expressions.push(statement.matchExpression);
        for (const stringCase of statement.stringCases) {
          walk(stringCase.statements);
        }
        walk(statement.elseStatements);
      }
    }
  }

  walk(statements);
  return expressions;
}

function collectStateElapsedReferencesFromExpression(
  expression: BoundExpression,
): Array<BoundExpression & { kind: "state_path_elapsed_reference" }> {
  const references: Array<BoundExpression & { kind: "state_path_elapsed_reference" }> = [];

  function walk(currentExpression: BoundExpression): void {
    if (currentExpression.kind === "state_path_elapsed_reference") {
      references.push(currentExpression);
      return;
    }
    if (
      currentExpression.kind === "binary_add" ||
      currentExpression.kind === "binary_sub" ||
      currentExpression.kind === "binary_mul" ||
      currentExpression.kind === "binary_div" ||
      currentExpression.kind === "comparison"
    ) {
      walk(currentExpression.left);
      walk(currentExpression.right);
      return;
    }
    if (currentExpression.kind === "unary_minus") {
      walk(currentExpression.operand);
      return;
    }
    if (currentExpression.kind === "step_animator" && currentExpression.targetExpression !== undefined) {
      walk(currentExpression.targetExpression);
      return;
    }
    if (currentExpression.kind === "match_expression") {
      walk(currentExpression.scrutinee);
      for (const arm of currentExpression.arms) {
        collectExpressionsFromMatchPattern(arm.pattern).forEach(walk);
        walk(arm.resultExpression);
      }
      if (currentExpression.elseResultExpression !== undefined) {
        walk(currentExpression.elseResultExpression);
      }
    }
  }

  walk(expression);
  return references;
}

function collectExpressionsFromMatchPattern(pattern: BoundMatchPattern): BoundExpression[] {
  if (pattern.kind === "equality_pattern") {
    return [pattern.compareExpression];
  }

  const expressions: BoundExpression[] = [];
  if (pattern.startInclusive !== undefined) {
    expressions.push(pattern.startInclusive);
  }
  if (pattern.endExclusive !== undefined) {
    expressions.push(pattern.endExclusive);
  }
  return expressions;
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
