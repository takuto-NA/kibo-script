/**
 * AST を走査し ref を DeviceAddress に解決し、task 内の do 呼び出しをバインドする。
 */

import type { ProgramAst, TaskDeclarationAst } from "../ast/script-ast";
import { parseDeviceAddress } from "../core/device-address";
import type { DiagnosticReport, SourceRange } from "../diagnostics/diagnostic";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import {
  buildNameDuplicateDeclaration,
  buildNameUnknownReference,
} from "../diagnostics/diagnostic-builder";
import type { BoundDoStatement, BoundProgram, BoundRefSymbol, BoundTask } from "./bound-program";
import { RefSymbolTable } from "./symbol-table";

export type BindProgramResult =
  | { ok: true; boundProgram: BoundProgram }
  | { ok: false; report: DiagnosticReport };

function astRangeToSourceRange(range: {
  fileName: string;
  start: SourceRange["start"];
  end: SourceRange["end"];
}): SourceRange {
  return {
    file: range.fileName,
    start: range.start,
    end: range.end,
  };
}

export function bindProgram(ast: ProgramAst, sourceFileName: string): BindProgramResult {
  const refSymbolTable = new RefSymbolTable();
  const diagnostics: DiagnosticReport["diagnostics"] = [];

  for (const declaration of ast.declarations) {
    if (declaration.kind !== "ref_declaration") {
      continue;
    }

    const deviceReferenceText = `${declaration.deviceKind}#${declaration.deviceId}`;
    const parseAddressResult = parseDeviceAddress(deviceReferenceText);
    if (parseAddressResult.ok === false) {
      diagnostics.push(
        buildNameUnknownReference({
          name: deviceReferenceText,
          range: astRangeToSourceRange(declaration.range),
          rangeText: deviceReferenceText,
        }),
      );
      continue;
    }

    const registerResult = refSymbolTable.tryRegister({
      symbolName: declaration.symbolName,
      deviceAddress: parseAddressResult.address,
      declarationRange: declaration.range,
    });

    if (registerResult.ok === false) {
      diagnostics.push(
        buildNameDuplicateDeclaration({
          name: declaration.symbolName,
          range: astRangeToSourceRange(declaration.range),
          secondaryRange: astRangeToSourceRange(registerResult.existing.declarationRange),
        }),
      );
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, report: createDiagnosticReport(diagnostics) };
  }

  const boundTasks: BoundTask[] = [];

  for (const declaration of ast.declarations) {
    if (declaration.kind !== "task_declaration") {
      continue;
    }
    const bindTaskResult = bindTaskDeclaration({
      taskDeclaration: declaration,
      refSymbolTable,
    });
    if (bindTaskResult.ok === false) {
      return bindTaskResult;
    }
    boundTasks.push(bindTaskResult.boundTask);
  }

  const refSymbols = new Map<string, BoundRefSymbol>();
  for (const symbolEntry of refSymbolTable.listAllSymbolEntries()) {
    refSymbols.set(symbolEntry.symbolName, {
      symbolName: symbolEntry.symbolName,
      deviceAddress: symbolEntry.deviceAddress,
      range: symbolEntry.declarationRange,
    });
  }

  const boundProgram: BoundProgram = {
    sourceFileName,
    refSymbols,
    tasks: boundTasks,
  };

  return { ok: true, boundProgram };
}

function bindTaskDeclaration(params: {
  taskDeclaration: TaskDeclarationAst;
  refSymbolTable: RefSymbolTable;
}): { ok: true; boundTask: BoundTask } | { ok: false; report: DiagnosticReport } {
  const boundStatements: BoundDoStatement[] = [];

  for (const statement of params.taskDeclaration.bodyStatements) {
    if (statement.kind !== "do_statement") {
      continue;
    }
    const receiverName = statement.callExpression.receiver.name;
    const symbolEntry = params.refSymbolTable.lookup(receiverName);
    if (symbolEntry === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildNameUnknownReference({
            name: receiverName,
            range: astRangeToSourceRange(statement.callExpression.receiver.range),
            rangeText: receiverName,
          }),
        ]),
      };
    }

    boundStatements.push({
      deviceAddress: symbolEntry.deviceAddress,
      methodName: statement.callExpression.methodName,
      arguments: statement.callExpression.arguments.map((argument) => {
        if (argument.kind === "integer_argument") {
          return { kind: "integer" as const, value: argument.value };
        }
        return { kind: "string" as const, value: argument.value };
      }),
      range: statement.range,
    });
  }

  const boundTask: BoundTask = {
    taskName: params.taskDeclaration.taskName,
    intervalValue: params.taskDeclaration.intervalValue,
    intervalUnit: params.taskDeclaration.intervalUnit,
    intervalRange: params.taskDeclaration.intervalRange,
    statements: boundStatements,
    range: params.taskDeclaration.range,
  };

  return { ok: true, boundTask };
}
