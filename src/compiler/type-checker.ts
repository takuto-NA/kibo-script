/**
 * バインド済み program のタスク間隔・メソッド・式の型を検査する。
 */

import type {
  BoundDoStatement,
  BoundAnimatorSymbol,
  BoundExpression,
  BoundMatchPattern,
  BoundMatchStatement,
  BoundProgram,
  BoundSetStatement,
  BoundStatement,
  BoundTask,
} from "./bound-program";
import { convertAstRangeToSourceRange } from "./ast-range-to-source-range";
import { MIN_PWM_PERCENT, MAX_PWM_PERCENT } from "../core/animator-ramp";
import { DEVICE_METHOD_SIGNATURES } from "./static-type";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import {
  buildAnimatorEaseUnsupported,
  buildAnimatorStepForbidsTargetExpression,
  buildAnimatorStepRequiresTargetExpression,
  buildAnimatorTimeExpressionInvalidContext,
  buildMatchBranchUnsupportedStatement,
  buildMatchTargetRequiresString,
  buildPercentLiteralOutOfRange,
  buildTypeArgumentTypeMismatch,
  buildTypeMethodArityMismatch,
  buildTypeMethodNotFound,
  buildUnitTypeMismatch,
} from "../diagnostics/diagnostic-builder";

export function typeCheckBoundProgram(boundProgram: BoundProgram): DiagnosticReport {
  const diagnostics: DiagnosticReport["diagnostics"] = [];

  const stateValueKinds = new Map<string, "integer" | "string">();

  for (const row of boundProgram.valueSymbolsInSourceOrder) {
    const inferredKind = inferBoundExpressionValueKind(row.initialValue, stateValueKinds, boundProgram);
    if (inferredKind === undefined) {
      diagnostics.push(
        buildTypeArgumentTypeMismatch({
          message: `Cannot infer a concrete type for ${row.kind} "${row.name}" initializer.`,
          range: convertAstRangeToSourceRange(row.range),
        }),
      );
      continue;
    }
    stateValueKinds.set(row.name, inferredKind);
    collectPercentLiteralDiagnostics(row.initialValue, diagnostics);
    collectDisallowedAnimatorTimeExpressionsOutsideEveryTask(row.initialValue, diagnostics);
  }

  for (const animatorSymbol of boundProgram.animatorSymbolsInSourceOrder) {
    collectAnimatorDeclarationTypeDiagnostics(animatorSymbol, diagnostics);
  }

  for (const task of boundProgram.tasks) {
    if (task.intervalUnit !== "ms") {
      diagnostics.push(
        buildUnitTypeMismatch({
          message: 'Task "every" interval must use the "ms" time unit.',
          range: convertAstRangeToSourceRange(task.intervalRange),
          rangeText: undefined,
          expected: { kind: "unit", unit: "ms" },
          actual: { kind: "unit", unit: task.intervalUnit },
        }),
      );
    }

    for (const statement of task.statements) {
      collectStatementTypeDiagnostics({
        statement,
        diagnostics,
        stateValueKinds,
        taskExecutionKind: "every_task",
        boundProgram,
      });
    }
  }

  for (const task of boundProgram.onEventTasks) {
    for (const statement of task.statements) {
      collectStatementTypeDiagnostics({
        statement,
        diagnostics,
        stateValueKinds,
        taskExecutionKind: "on_event_task",
        boundProgram,
      });
    }
  }

  const visitAnimatorStepDiagnostics = (expression: BoundExpression): void => {
    collectStepAnimatorRampKindConsistencyDiagnostics(expression, boundProgram, diagnostics);
    collectStepAnimatorTargetIntegerDiagnostics(expression, stateValueKinds, diagnostics, boundProgram);
  };

  for (const stateSymbol of boundProgram.stateSymbolsInSourceOrder) {
    walkBoundExpressionTree(stateSymbol.initialValue, visitAnimatorStepDiagnostics);
  }
  for (const constSymbol of boundProgram.constSymbolsInSourceOrder) {
    walkBoundExpressionTree(constSymbol.initialValue, visitAnimatorStepDiagnostics);
  }
  for (const task of boundProgram.tasks) {
    for (const statement of task.statements) {
      walkStatementBoundExpressions(statement, visitAnimatorStepDiagnostics);
    }
  }
  for (const task of boundProgram.onEventTasks) {
    for (const statement of task.statements) {
      walkStatementBoundExpressions(statement, visitAnimatorStepDiagnostics);
    }
  }

  return createDiagnosticReport(diagnostics);
}

type ExpressionValueKind = "integer" | "string";

type TaskExecutionKind = "every_task" | "on_event_task";

function inferBoundExpressionValueKind(
  expression: BoundExpression,
  stateValueKinds: Map<string, ExpressionValueKind>,
  boundProgram: BoundProgram,
): ExpressionValueKind | undefined {
  if (expression.kind === "integer") {
    return "integer";
  }

  if (expression.kind === "string") {
    return "string";
  }

  if (expression.kind === "identifier") {
    return stateValueKinds.get(expression.name);
  }

  if (expression.kind === "const_reference") {
    const symbol = boundProgram.constSymbols.get(expression.constName);
    if (symbol === undefined) {
      return undefined;
    }
    return inferBoundExpressionValueKind(symbol.initialValue, stateValueKinds, boundProgram);
  }

  if (expression.kind === "temp_reference") {
    return undefined;
  }

  if (expression.kind === "binary_add") {
    const leftKind = inferBoundExpressionValueKind(expression.left, stateValueKinds, boundProgram);
    const rightKind = inferBoundExpressionValueKind(expression.right, stateValueKinds, boundProgram);
    if (leftKind === "integer" && rightKind === "integer") {
      return "integer";
    }
    return undefined;
  }

  if (expression.kind === "binary_sub" || expression.kind === "binary_mul" || expression.kind === "binary_div") {
    const leftKind = inferBoundExpressionValueKind(expression.left, stateValueKinds, boundProgram);
    const rightKind = inferBoundExpressionValueKind(expression.right, stateValueKinds, boundProgram);
    if (leftKind === "integer" && rightKind === "integer") {
      return "integer";
    }
    return undefined;
  }

  if (expression.kind === "unary_minus") {
    return inferBoundExpressionValueKind(expression.operand, stateValueKinds, boundProgram);
  }

  if (expression.kind === "comparison") {
    return undefined;
  }

  if (expression.kind === "match_expression") {
    return undefined;
  }

  if (expression.kind === "read_property") {
    return inferReadPropertyValueKind(expression);
  }

  if (expression.kind === "percent") {
    return "integer";
  }

  if (expression.kind === "dt_reference") {
    return "integer";
  }

  if (expression.kind === "step_animator") {
    return "integer";
  }

  return undefined;
}

function inferReadPropertyValueKind(expression: BoundExpression & { kind: "read_property" }): ExpressionValueKind | undefined {
  if (expression.deviceAddress.kind !== "adc") {
    return undefined;
  }
  if (expression.propertyName === "info") {
    return "string";
  }
  return "integer";
}

function collectMatchStatementTypeDiagnostics(params: {
  statement: BoundMatchStatement;
  diagnostics: DiagnosticReport["diagnostics"];
  stateValueKinds: Map<string, ExpressionValueKind>;
  taskExecutionKind: TaskExecutionKind;
  boundProgram: BoundProgram;
}): void {
  const matchTargetKind = inferBoundExpressionValueKind(
    params.statement.matchExpression,
    params.stateValueKinds,
    params.boundProgram,
  );
  if (matchTargetKind !== "string") {
    params.diagnostics.push(
      buildMatchTargetRequiresString({
        range: convertAstRangeToSourceRange(params.statement.range),
      }),
    );
  }

  if (params.taskExecutionKind === "on_event_task") {
    collectAnimatorTimeExpressionsInvalidForNonEveryTask(params.statement.matchExpression, params.diagnostics);
  }

  for (const stringCase of params.statement.stringCases) {
    for (const branchStatement of stringCase.statements) {
      collectMatchBranchStatementTypeDiagnostics({
        statement: branchStatement,
        diagnostics: params.diagnostics,
        stateValueKinds: params.stateValueKinds,
        taskExecutionKind: params.taskExecutionKind,
        boundProgram: params.boundProgram,
      });
    }
  }

  for (const branchStatement of params.statement.elseStatements) {
    collectMatchBranchStatementTypeDiagnostics({
      statement: branchStatement,
      diagnostics: params.diagnostics,
      stateValueKinds: params.stateValueKinds,
      taskExecutionKind: params.taskExecutionKind,
      boundProgram: params.boundProgram,
    });
  }
}

function collectMatchBranchStatementTypeDiagnostics(params: {
  statement: BoundStatement;
  diagnostics: DiagnosticReport["diagnostics"];
  stateValueKinds: Map<string, ExpressionValueKind>;
  taskExecutionKind: TaskExecutionKind;
  boundProgram: BoundProgram;
}): void {
  if (params.statement.kind === "wait_statement") {
    params.diagnostics.push(
      buildMatchBranchUnsupportedStatement({
        message: "match branch cannot contain 'wait' in this language version.",
        range: convertAstRangeToSourceRange(params.statement.range),
      }),
    );
    return;
  }

  if (params.statement.kind === "match_statement") {
    params.diagnostics.push(
      buildMatchBranchUnsupportedStatement({
        message: "match branch cannot contain nested 'match' in this language version.",
        range: convertAstRangeToSourceRange(params.statement.range),
      }),
    );
    return;
  }

  if (params.statement.kind === "do_statement") {
    collectMethodCallTypeDiagnostics({
      statement: params.statement,
      diagnostics: params.diagnostics,
      stateValueKinds: params.stateValueKinds,
      taskExecutionKind: params.taskExecutionKind,
      boundProgram: params.boundProgram,
    });
    return;
  }

  if (params.statement.kind === "set_statement") {
    collectSetStatementTypeDiagnostics({
      statement: params.statement,
      diagnostics: params.diagnostics,
      stateValueKinds: params.stateValueKinds,
      taskExecutionKind: params.taskExecutionKind,
      boundProgram: params.boundProgram,
    });
    return;
  }

  if (params.statement.kind === "temp_statement") {
    collectAnimatorTimeExpressionsInvalidForNonEveryTask(params.statement.valueExpression, params.diagnostics);
    return;
  }

  if (params.statement.kind === "if_statement") {
    collectAnimatorTimeExpressionsInvalidForNonEveryTask(params.statement.conditionExpression, params.diagnostics);
    for (const branchStatement of params.statement.thenStatements) {
      collectMatchBranchStatementTypeDiagnostics({
        statement: branchStatement,
        diagnostics: params.diagnostics,
        stateValueKinds: params.stateValueKinds,
        taskExecutionKind: params.taskExecutionKind,
        boundProgram: params.boundProgram,
      });
    }
    for (const branchStatement of params.statement.elseStatements) {
      collectMatchBranchStatementTypeDiagnostics({
        statement: branchStatement,
        diagnostics: params.diagnostics,
        stateValueKinds: params.stateValueKinds,
        taskExecutionKind: params.taskExecutionKind,
        boundProgram: params.boundProgram,
      });
    }
    return;
  }

  params.diagnostics.push(
    buildMatchBranchUnsupportedStatement({
      message: "match branch contains an unsupported statement in this language version.",
      range: convertAstRangeToSourceRange((params.statement as BoundStatement).range),
    }),
  );
}

function collectStatementTypeDiagnostics(params: {
  statement: BoundStatement;
  diagnostics: DiagnosticReport["diagnostics"];
  stateValueKinds: Map<string, ExpressionValueKind>;
  taskExecutionKind: TaskExecutionKind;
  boundProgram: BoundProgram;
}): void {
  const statement = params.statement;

  if (statement.kind === "do_statement") {
    collectMethodCallTypeDiagnostics({
      statement,
      diagnostics: params.diagnostics,
      stateValueKinds: params.stateValueKinds,
      taskExecutionKind: params.taskExecutionKind,
      boundProgram: params.boundProgram,
    });
    return;
  }

  if (statement.kind === "set_statement") {
    collectSetStatementTypeDiagnostics({
      statement,
      diagnostics: params.diagnostics,
      stateValueKinds: params.stateValueKinds,
      taskExecutionKind: params.taskExecutionKind,
      boundProgram: params.boundProgram,
    });
    return;
  }

  if (statement.kind === "match_statement") {
    collectMatchStatementTypeDiagnostics({
      statement,
      diagnostics: params.diagnostics,
      stateValueKinds: params.stateValueKinds,
      taskExecutionKind: params.taskExecutionKind,
      boundProgram: params.boundProgram,
    });
    return;
  }

  if (statement.kind === "temp_statement") {
    if (params.taskExecutionKind === "on_event_task") {
      collectAnimatorTimeExpressionsInvalidForNonEveryTask(statement.valueExpression, params.diagnostics);
    }
    return;
  }

  if (statement.kind === "if_statement") {
    if (params.taskExecutionKind === "on_event_task") {
      collectAnimatorTimeExpressionsInvalidForNonEveryTask(statement.conditionExpression, params.diagnostics);
    }
    for (const branchStatement of statement.thenStatements) {
      collectStatementTypeDiagnostics({
        statement: branchStatement,
        diagnostics: params.diagnostics,
        stateValueKinds: params.stateValueKinds,
        taskExecutionKind: params.taskExecutionKind,
        boundProgram: params.boundProgram,
      });
    }
    for (const branchStatement of statement.elseStatements) {
      collectStatementTypeDiagnostics({
        statement: branchStatement,
        diagnostics: params.diagnostics,
        stateValueKinds: params.stateValueKinds,
        taskExecutionKind: params.taskExecutionKind,
        boundProgram: params.boundProgram,
      });
    }
    return;
  }

  if (statement.kind === "wait_statement") {
    return;
  }

  const exhaustiveStatement: never = statement;
  void exhaustiveStatement;
}

function collectSetStatementTypeDiagnostics(params: {
  statement: BoundSetStatement;
  diagnostics: DiagnosticReport["diagnostics"];
  stateValueKinds: Map<string, ExpressionValueKind>;
  taskExecutionKind: TaskExecutionKind;
  boundProgram: BoundProgram;
}): void {
  if (params.taskExecutionKind === "on_event_task") {
    collectAnimatorTimeExpressionsInvalidForNonEveryTask(params.statement.valueExpression, params.diagnostics);
  }

  const expectedKind = params.stateValueKinds.get(params.statement.stateName);
  const actualKind = inferBoundExpressionValueKind(
    params.statement.valueExpression,
    params.stateValueKinds,
    params.boundProgram,
  );
  if (expectedKind !== undefined && actualKind !== undefined && expectedKind !== actualKind) {
    params.diagnostics.push(
      buildTypeArgumentTypeMismatch({
        message: `set assigns incompatible type to "${params.statement.stateName}".`,
        range: convertAstRangeToSourceRange(params.statement.range),
        expected: { kind: "string", value: expectedKind },
        actual: { kind: "string", value: actualKind },
      }),
    );
  }
}

function collectMethodCallTypeDiagnostics(params: {
  statement: BoundDoStatement;
  diagnostics: DiagnosticReport["diagnostics"];
  stateValueKinds: Map<string, ExpressionValueKind>;
  taskExecutionKind: TaskExecutionKind;
  boundProgram: BoundProgram;
}): void {
  const statement = params.statement;
  const methodSignatures = DEVICE_METHOD_SIGNATURES[statement.deviceAddress.kind];
  const methodSignature = methodSignatures[statement.methodName];
  if (methodSignature === undefined) {
    params.diagnostics.push(
      buildTypeMethodNotFound({
        methodName: statement.methodName,
        deviceKindName: statement.deviceAddress.kind,
        range: convertAstRangeToSourceRange(statement.range),
        rangeText: statement.methodName,
      }),
    );
    return;
  }

  const actualParameterCount = statement.arguments.length;
  if (
    actualParameterCount < methodSignature.minimumParameterCount ||
    actualParameterCount > methodSignature.maximumParameterCount
  ) {
    params.diagnostics.push(
      buildTypeMethodArityMismatch({
        methodName: statement.methodName,
        range: convertAstRangeToSourceRange(statement.range),
        expectedMinimumParameterCount: methodSignature.minimumParameterCount,
        expectedMaximumParameterCount: methodSignature.maximumParameterCount,
        actualParameterCount,
      }),
    );
    return;
  }

  if (statement.deviceAddress.kind === "serial" && statement.methodName === "println") {
    const firstArgument = statement.arguments[0];
    if (firstArgument === undefined) {
      return;
    }
    const printableKind = inferBoundExpressionValueKind(firstArgument, params.stateValueKinds, params.boundProgram);
    if (printableKind === undefined) {
      params.diagnostics.push(
        buildTypeArgumentTypeMismatch({
          message: "serial.println expects a printable argument (string or integer).",
          range: convertAstRangeToSourceRange(statement.range),
        }),
      );
      return;
    }
    if (printableKind !== "string" && printableKind !== "integer") {
      params.diagnostics.push(
        buildTypeArgumentTypeMismatch({
          message: "serial.println expects a string or integer argument for now.",
          range: convertAstRangeToSourceRange(statement.range),
        }),
      );
    }
    return;
  }

  if (statement.deviceAddress.kind === "display") {
    const expectsIntegerParameterIndexes =
      statement.methodName === "circle"
        ? [0, 1, 2]
        : statement.methodName === "pixel"
          ? [0, 1]
          : statement.methodName === "line"
            ? [0, 1, 2, 3]
            : [];

    for (const parameterIndex of expectsIntegerParameterIndexes) {
      const argumentExpression = statement.arguments[parameterIndex];
      if (argumentExpression === undefined) {
        continue;
      }
      const kind = inferBoundExpressionValueKind(argumentExpression, params.stateValueKinds, params.boundProgram);
      if (kind !== "integer") {
        params.diagnostics.push(
          buildTypeArgumentTypeMismatch({
            message: `Argument ${parameterIndex + 1} of display.${statement.methodName} must be an integer expression.`,
            range: convertAstRangeToSourceRange(statement.range),
            expected: { kind: "string", value: "integer" },
            actual: { kind: "string", value: kind ?? "unknown" },
          }),
        );
        return;
      }
    }
    return;
  }

  if (statement.deviceAddress.kind === "pwm" && statement.methodName === "level") {
    const firstArgument = statement.arguments[0];
    if (firstArgument === undefined) {
      return;
    }
    const pwmArgumentKind = inferBoundExpressionValueKind(firstArgument, params.stateValueKinds, params.boundProgram);
    if (pwmArgumentKind !== "integer") {
      params.diagnostics.push(
        buildTypeArgumentTypeMismatch({
          message: "pwm.level expects an integer percent argument.",
          range: convertAstRangeToSourceRange(statement.range),
          expected: { kind: "string", value: "integer" },
          actual: { kind: "string", value: pwmArgumentKind ?? "unknown" },
        }),
      );
    }
  }

  if (params.taskExecutionKind === "on_event_task") {
    for (const argumentExpression of statement.arguments) {
      collectAnimatorTimeExpressionsInvalidForNonEveryTask(argumentExpression, params.diagnostics);
    }
  }
}

function collectAnimatorDeclarationTypeDiagnostics(
  animator: BoundAnimatorSymbol,
  diagnostics: DiagnosticReport["diagnostics"],
): void {
  if (animator.rampKind === "from_to") {
    if (animator.fromPercent < MIN_PWM_PERCENT || animator.fromPercent > MAX_PWM_PERCENT) {
      diagnostics.push(
        buildPercentLiteralOutOfRange({
          range: convertAstRangeToSourceRange(animator.fromPercentRange),
          actualPercent: animator.fromPercent,
        }),
      );
    }

    if (animator.toPercent < MIN_PWM_PERCENT || animator.toPercent > MAX_PWM_PERCENT) {
      diagnostics.push(
        buildPercentLiteralOutOfRange({
          range: convertAstRangeToSourceRange(animator.toPercentRange),
          actualPercent: animator.toPercent,
        }),
      );
    }
  }

  if (animator.durationUnit !== "ms") {
    diagnostics.push(
      buildUnitTypeMismatch({
        message: 'Animator ramp duration must use the "ms" time unit.',
        range: convertAstRangeToSourceRange(animator.durationRange),
        expected: { kind: "unit", unit: "ms" },
        actual: { kind: "unit", unit: animator.durationUnit },
      }),
    );
  }

  if (animator.easeName !== "linear" && animator.easeName !== "ease_in_out") {
    diagnostics.push(
      buildAnimatorEaseUnsupported({
        easeName: animator.easeName,
        range: convertAstRangeToSourceRange(animator.easeRange),
      }),
    );
  }
}

function collectPercentLiteralDiagnostics(
  expression: BoundExpression,
  diagnostics: DiagnosticReport["diagnostics"],
): void {
  if (expression.kind === "percent") {
    if (expression.value < MIN_PWM_PERCENT || expression.value > MAX_PWM_PERCENT) {
      diagnostics.push(
        buildPercentLiteralOutOfRange({
          range: convertAstRangeToSourceRange(expression.range),
          rangeText: String(expression.value),
          actualPercent: expression.value,
        }),
      );
    }
    return;
  }

  if (expression.kind === "binary_add") {
    collectPercentLiteralDiagnostics(expression.left, diagnostics);
    collectPercentLiteralDiagnostics(expression.right, diagnostics);
    return;
  }

  if (
    expression.kind === "binary_sub" ||
    expression.kind === "binary_mul" ||
    expression.kind === "binary_div"
  ) {
    collectPercentLiteralDiagnostics(expression.left, diagnostics);
    collectPercentLiteralDiagnostics(expression.right, diagnostics);
    return;
  }

  if (expression.kind === "unary_minus") {
    collectPercentLiteralDiagnostics(expression.operand, diagnostics);
    return;
  }

  if (expression.kind === "step_animator" && expression.targetExpression !== undefined) {
    collectPercentLiteralDiagnostics(expression.targetExpression, diagnostics);
  }
}

function collectDisallowedAnimatorTimeExpressionsOutsideEveryTask(
  expression: BoundExpression,
  diagnostics: DiagnosticReport["diagnostics"],
): void {
  collectAnimatorTimeExpressionsInvalidForNonEveryTask(expression, diagnostics);
}

function collectAnimatorTimeExpressionsInvalidForNonEveryTask(
  expression: BoundExpression,
  diagnostics: DiagnosticReport["diagnostics"],
): void {
  if (expression.kind === "step_animator") {
    if (expression.targetExpression !== undefined) {
      collectAnimatorTimeExpressionsInvalidForNonEveryTask(expression.targetExpression, diagnostics);
    }
    diagnostics.push(
      buildAnimatorTimeExpressionInvalidContext({
        range: convertAstRangeToSourceRange(expression.range),
      }),
    );
    return;
  }

  if (expression.kind === "dt_reference") {
    diagnostics.push(
      buildAnimatorTimeExpressionInvalidContext({
        range: convertAstRangeToSourceRange(expression.range),
      }),
    );
    return;
  }

  if (expression.kind === "binary_add") {
    collectAnimatorTimeExpressionsInvalidForNonEveryTask(expression.left, diagnostics);
    collectAnimatorTimeExpressionsInvalidForNonEveryTask(expression.right, diagnostics);
    return;
  }

  if (
    expression.kind === "binary_sub" ||
    expression.kind === "binary_mul" ||
    expression.kind === "binary_div"
  ) {
    collectAnimatorTimeExpressionsInvalidForNonEveryTask(expression.left, diagnostics);
    collectAnimatorTimeExpressionsInvalidForNonEveryTask(expression.right, diagnostics);
    return;
  }

  if (expression.kind === "unary_minus") {
    collectAnimatorTimeExpressionsInvalidForNonEveryTask(expression.operand, diagnostics);
    return;
  }

  if (expression.kind === "comparison") {
    collectAnimatorTimeExpressionsInvalidForNonEveryTask(expression.left, diagnostics);
    collectAnimatorTimeExpressionsInvalidForNonEveryTask(expression.right, diagnostics);
  }
}

function walkBoundExpressionTree(
  expression: BoundExpression,
  visit: (expression: BoundExpression) => void,
): void {
  visit(expression);
  if (expression.kind === "binary_add") {
    walkBoundExpressionTree(expression.left, visit);
    walkBoundExpressionTree(expression.right, visit);
    return;
  }
  if (
    expression.kind === "binary_sub" ||
    expression.kind === "binary_mul" ||
    expression.kind === "binary_div"
  ) {
    walkBoundExpressionTree(expression.left, visit);
    walkBoundExpressionTree(expression.right, visit);
    return;
  }
  if (expression.kind === "unary_minus") {
    walkBoundExpressionTree(expression.operand, visit);
    return;
  }
  if (expression.kind === "comparison") {
    walkBoundExpressionTree(expression.left, visit);
    walkBoundExpressionTree(expression.right, visit);
    return;
  }
  if (expression.kind === "match_expression") {
    walkBoundExpressionTree(expression.scrutinee, visit);
    for (const arm of expression.arms) {
      walkBoundMatchPatternTree(arm.pattern, visit);
      walkBoundExpressionTree(arm.resultExpression, visit);
    }
    if (expression.elseResultExpression !== undefined) {
      walkBoundExpressionTree(expression.elseResultExpression, visit);
    }
    return;
  }
  if (expression.kind === "step_animator" && expression.targetExpression !== undefined) {
    walkBoundExpressionTree(expression.targetExpression, visit);
  }
}

function walkBoundMatchPatternTree(
  pattern: BoundMatchPattern,
  visit: (expression: BoundExpression) => void,
): void {
  if (pattern.kind === "equality_pattern") {
    walkBoundExpressionTree(pattern.compareExpression, visit);
    return;
  }
  if (pattern.startInclusive !== undefined) {
    walkBoundExpressionTree(pattern.startInclusive, visit);
  }
  if (pattern.endExclusive !== undefined) {
    walkBoundExpressionTree(pattern.endExclusive, visit);
  }
}

function walkStatementBoundExpressions(
  statement: BoundStatement,
  visit: (expression: BoundExpression) => void,
): void {
  if (statement.kind === "set_statement") {
    walkBoundExpressionTree(statement.valueExpression, visit);
    return;
  }
  if (statement.kind === "do_statement") {
    for (const argumentExpression of statement.arguments) {
      walkBoundExpressionTree(argumentExpression, visit);
    }
    return;
  }
  if (statement.kind === "match_statement") {
    walkBoundExpressionTree(statement.matchExpression, visit);
    for (const stringCase of statement.stringCases) {
      for (const branchStatement of stringCase.statements) {
        walkStatementBoundExpressions(branchStatement, visit);
      }
    }
    for (const branchStatement of statement.elseStatements) {
      walkStatementBoundExpressions(branchStatement, visit);
    }
    return;
  }
  if (statement.kind === "temp_statement") {
    walkBoundExpressionTree(statement.valueExpression, visit);
    return;
  }
  if (statement.kind === "if_statement") {
    walkBoundExpressionTree(statement.conditionExpression, visit);
    for (const branchStatement of statement.thenStatements) {
      walkStatementBoundExpressions(branchStatement, visit);
    }
    for (const branchStatement of statement.elseStatements) {
      walkStatementBoundExpressions(branchStatement, visit);
    }
    return;
  }
  if (statement.kind === "wait_statement") {
    return;
  }
  const exhaustiveStatement: never = statement;
  void exhaustiveStatement;
}

function collectStepAnimatorRampKindConsistencyDiagnostics(
  expression: BoundExpression,
  boundProgram: BoundProgram,
  diagnostics: DiagnosticReport["diagnostics"],
): void {
  if (expression.kind !== "step_animator") {
    return;
  }

  const animatorSymbol = boundProgram.animatorSymbols.get(expression.animatorName);
  if (animatorSymbol === undefined) {
    return;
  }

  if (animatorSymbol.rampKind === "over_only" && expression.targetExpression === undefined) {
    diagnostics.push(
      buildAnimatorStepRequiresTargetExpression({
        range: convertAstRangeToSourceRange(expression.range),
      }),
    );
    return;
  }

  if (animatorSymbol.rampKind === "from_to" && expression.targetExpression !== undefined) {
    diagnostics.push(
      buildAnimatorStepForbidsTargetExpression({
        range: convertAstRangeToSourceRange(expression.range),
      }),
    );
  }
}

function collectStepAnimatorTargetIntegerDiagnostics(
  expression: BoundExpression,
  stateValueKinds: Map<string, ExpressionValueKind>,
  diagnostics: DiagnosticReport["diagnostics"],
  boundProgram: BoundProgram,
): void {
  if (expression.kind !== "step_animator") {
    return;
  }
  if (expression.targetExpression === undefined) {
    return;
  }

  const targetKind = inferBoundExpressionValueKind(expression.targetExpression, stateValueKinds, boundProgram);
  if (targetKind !== "integer") {
    diagnostics.push(
      buildTypeArgumentTypeMismatch({
        message: "Animator step target must be an integer percent expression.",
        range: convertAstRangeToSourceRange(expression.range),
        expected: { kind: "string", value: "integer" },
        actual: { kind: "string", value: targetKind ?? "unknown" },
      }),
    );
  }
}
