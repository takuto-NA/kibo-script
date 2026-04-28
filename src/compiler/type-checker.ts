/**
 * バインド済み program のタスク間隔の単位と、デバイスメソッド呼び出しの型を検査する。
 */

import type { BoundDoStatement, BoundProgram } from "./bound-program";
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
      collectMethodCallTypeDiagnostics(statement, diagnostics);
    }
  }

  return createDiagnosticReport(diagnostics);
}

function collectMethodCallTypeDiagnostics(
  statement: BoundDoStatement,
  diagnostics: DiagnosticReport["diagnostics"],
): void {
  const methodSignatures = DEVICE_METHOD_SIGNATURES[statement.deviceAddress.kind];
  const methodSignature = methodSignatures[statement.methodName];
  if (methodSignature === undefined) {
    diagnostics.push(
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
    diagnostics.push(
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
    if (firstArgument !== undefined && firstArgument.kind !== "string") {
      diagnostics.push(
        buildTypeArgumentTypeMismatch({
          message: "serial.println expects a string argument.",
          range: convertAstRangeToSourceRange(statement.range),
          expected: { kind: "string", value: "string" },
          actual: { kind: "number", value: firstArgument.value },
        }),
      );
    }
  }
}
