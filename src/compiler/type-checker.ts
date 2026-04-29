/**
 * バインド済み program のタスク間隔・メソッド・式の型を検査する。
 */

import type {
  BoundDoStatement,
  BoundExpression,
  BoundProgram,
  BoundSetStatement,
  BoundStatement,
  BoundTask,
} from "./bound-program";
import { convertAstRangeToSourceRange } from "./ast-range-to-source-range";
import { DEVICE_METHOD_SIGNATURES } from "./static-type";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import {
  buildTypeArgumentTypeMismatch,
  buildTypeMethodArityMismatch,
  buildTypeMethodNotFound,
  buildUnitTypeMismatch,
} from "../diagnostics/diagnostic-builder";

export function typeCheckBoundProgram(boundProgram: BoundProgram): DiagnosticReport {
  const diagnostics: DiagnosticReport["diagnostics"] = [];

  const stateValueKinds = new Map<string, "integer" | "string">();

  for (const [stateName, symbol] of boundProgram.stateSymbols.entries()) {
    const inferredKind = inferBoundExpressionValueKind(symbol.initialValue, stateValueKinds);
    if (inferredKind === undefined) {
      diagnostics.push(
        buildTypeArgumentTypeMismatch({
          message: `Cannot infer a concrete type for state "${stateName}" initializer.`,
          range: convertAstRangeToSourceRange(symbol.range),
        }),
      );
      continue;
    }
    stateValueKinds.set(stateName, inferredKind);
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
      });
    }
  }

  for (const task of boundProgram.onEventTasks) {
    for (const statement of task.statements) {
      collectStatementTypeDiagnostics({
        statement,
        diagnostics,
        stateValueKinds,
      });
    }
  }

  return createDiagnosticReport(diagnostics);
}

type ExpressionValueKind = "integer" | "string";

function inferBoundExpressionValueKind(
  expression: BoundExpression,
  stateValueKinds: Map<string, ExpressionValueKind>,
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

  if (expression.kind === "binary_add") {
    const leftKind = inferBoundExpressionValueKind(expression.left, stateValueKinds);
    const rightKind = inferBoundExpressionValueKind(expression.right, stateValueKinds);
    if (leftKind === "integer" && rightKind === "integer") {
      return "integer";
    }
    return undefined;
  }

  if (expression.kind === "read_property") {
    return inferReadPropertyValueKind(expression);
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

function collectStatementTypeDiagnostics(params: {
  statement: BoundStatement;
  diagnostics: DiagnosticReport["diagnostics"];
  stateValueKinds: Map<string, ExpressionValueKind>;
}): void {
  const statement = params.statement;

  if (statement.kind === "do_statement") {
    collectMethodCallTypeDiagnostics({
      statement,
      diagnostics: params.diagnostics,
      stateValueKinds: params.stateValueKinds,
    });
    return;
  }

  if (statement.kind === "set_statement") {
    collectSetStatementTypeDiagnostics({
      statement,
      diagnostics: params.diagnostics,
      stateValueKinds: params.stateValueKinds,
    });
  }
}

function collectSetStatementTypeDiagnostics(params: {
  statement: BoundSetStatement;
  diagnostics: DiagnosticReport["diagnostics"];
  stateValueKinds: Map<string, ExpressionValueKind>;
}): void {
  const expectedKind = params.stateValueKinds.get(params.statement.stateName);
  const actualKind = inferBoundExpressionValueKind(params.statement.valueExpression, params.stateValueKinds);
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
    const printableKind = inferBoundExpressionValueKind(firstArgument, params.stateValueKinds);
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
      const kind = inferBoundExpressionValueKind(argumentExpression, params.stateValueKinds);
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
    const pwmArgumentKind = inferBoundExpressionValueKind(firstArgument, params.stateValueKinds);
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
}
