/**
 * AST を走査し ref / state を解決し、task 本体の文をバインドする。
 */

import type {
  MethodArgumentExpressionAst,
  ProgramAst,
  ReadTargetAst,
  TaskOnDeclarationAst,
  TaskDeclarationAst,
} from "../ast/script-ast";
import { parseDeviceAddress } from "../core/device-address";
import type { DeviceAddress } from "../core/device-address";
import type { DiagnosticReport, SourceRange } from "../diagnostics/diagnostic";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import {
  buildNameDuplicateDeclaration,
  buildNameUnknownReference,
} from "../diagnostics/diagnostic-builder";
import type {
  BoundDoStatement,
  BoundExpression,
  BoundOnEventTask,
  BoundProgram,
  BoundRefSymbol,
  BoundSetStatement,
  BoundStatement,
  BoundStateSymbol,
  BoundTask,
  BoundWaitStatement,
} from "./bound-program";
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
  const stateSymbols = new Map<string, BoundStateSymbol>();
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

  const stateDeclarations = ast.declarations.flatMap((declaration) =>
    declaration.kind === "state_declaration" ? [declaration] : [],
  );

  const successfulStateDeclarations: typeof stateDeclarations = [];

  for (const declaration of stateDeclarations) {
    const existingState = stateSymbols.get(declaration.stateName);
    if (existingState !== undefined) {
      diagnostics.push(
        buildNameDuplicateDeclaration({
          name: declaration.stateName,
          range: astRangeToSourceRange(declaration.range),
          secondaryRange: astRangeToSourceRange(existingState.range),
        }),
      );
      continue;
    }

    stateSymbols.set(declaration.stateName, {
      stateName: declaration.stateName,
      initialValue: { kind: "integer", value: 0 },
      range: declaration.range,
    });
    successfulStateDeclarations.push(declaration);
  }

  if (diagnostics.length > 0) {
    return { ok: false, report: createDiagnosticReport(diagnostics) };
  }

  for (const declaration of successfulStateDeclarations) {
    const bindExpressionResult = bindMethodArgumentExpression({
      expression: declaration.initialValueExpression,
      refSymbolTable,
      stateSymbols,
    });
    if (bindExpressionResult.ok === false) {
      return bindExpressionResult;
    }

    const existingEntry = stateSymbols.get(declaration.stateName);
    if (existingEntry === undefined) {
      continue;
    }

    stateSymbols.set(declaration.stateName, {
      stateName: declaration.stateName,
      initialValue: bindExpressionResult.expression,
      range: existingEntry.range,
    });
  }

  const boundTasks: BoundTask[] = [];
  const boundOnEventTasks: BoundOnEventTask[] = [];

  for (const declaration of ast.declarations) {
    if (declaration.kind === "task_declaration") {
      const bindTaskResult = bindTaskDeclaration({
        taskDeclaration: declaration,
        refSymbolTable,
        stateSymbols,
      });
      if (bindTaskResult.ok === false) {
        return bindTaskResult;
      }
      boundTasks.push(bindTaskResult.boundTask);
      continue;
    }

    if (declaration.kind === "task_on_declaration") {
      const bindOnResult = bindTaskOnDeclaration({
        taskOnDeclaration: declaration,
        refSymbolTable,
        stateSymbols,
      });
      if (bindOnResult.ok === false) {
        return bindOnResult;
      }
      boundOnEventTasks.push(bindOnResult.boundTask);
    }
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
    stateSymbols,
    stateSymbolsInSourceOrder: buildStateSymbolsInSourceOrder(ast, stateSymbols),
    tasks: boundTasks,
    onEventTasks: boundOnEventTasks,
  };

  return { ok: true, boundProgram };
}

function buildStateSymbolsInSourceOrder(
  ast: ProgramAst,
  stateSymbols: Map<string, BoundStateSymbol>,
): BoundStateSymbol[] {
  const ordered: BoundStateSymbol[] = [];
  for (const declaration of ast.declarations) {
    if (declaration.kind !== "state_declaration") {
      continue;
    }
    const symbol = stateSymbols.get(declaration.stateName);
    if (symbol !== undefined) {
      ordered.push(symbol);
    }
  }
  return ordered;
}

function bindTaskDeclaration(params: {
  taskDeclaration: TaskDeclarationAst;
  refSymbolTable: RefSymbolTable;
  stateSymbols: Map<string, BoundStateSymbol>;
}): { ok: true; boundTask: BoundTask } | { ok: false; report: DiagnosticReport } {
  const boundStatements: BoundStatement[] = [];

  for (const statement of params.taskDeclaration.bodyStatements) {
    const bindStatementResult = bindStatement({
      statement,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
    });
    if (bindStatementResult.ok === false) {
      return bindStatementResult;
    }
    boundStatements.push(bindStatementResult.boundStatement);
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

function bindTaskOnDeclaration(params: {
  taskOnDeclaration: TaskOnDeclarationAst;
  refSymbolTable: RefSymbolTable;
  stateSymbols: Map<string, BoundStateSymbol>;
}): { ok: true; boundTask: BoundOnEventTask } | { ok: false; report: DiagnosticReport } {
  const deviceReferenceText = `${params.taskOnDeclaration.deviceKind}#${params.taskOnDeclaration.deviceId}`;
  const parseAddressResult = parseDeviceAddress(deviceReferenceText);
  if (parseAddressResult.ok === false) {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildNameUnknownReference({
          name: deviceReferenceText,
          range: astRangeToSourceRange(params.taskOnDeclaration.range),
          rangeText: deviceReferenceText,
        }),
      ]),
    };
  }

  const boundStatements: BoundStatement[] = [];

  for (const statement of params.taskOnDeclaration.bodyStatements) {
    const bindStatementResult = bindStatement({
      statement,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
    });
    if (bindStatementResult.ok === false) {
      return bindStatementResult;
    }
    boundStatements.push(bindStatementResult.boundStatement);
  }

  const boundTask: BoundOnEventTask = {
    taskName: params.taskOnDeclaration.taskName,
    deviceAddress: parseAddressResult.address,
    eventName: params.taskOnDeclaration.eventName,
    statements: boundStatements,
    range: params.taskOnDeclaration.range,
  };

  return { ok: true, boundTask };
}

function bindStatement(params: {
  statement: import("../ast/script-ast").StatementAst;
  refSymbolTable: RefSymbolTable;
  stateSymbols: Map<string, BoundStateSymbol>;
}): { ok: true; boundStatement: BoundStatement } | { ok: false; report: DiagnosticReport } {
  if (params.statement.kind === "do_statement") {
    const receiver = params.statement.callExpression.receiver;
    const resolveReceiverResult = resolveCallReceiverToDeviceAddress({
      receiver,
      refSymbolTable: params.refSymbolTable,
    });
    if (resolveReceiverResult.ok === false) {
      return resolveReceiverResult;
    }

    const argumentResults: BoundExpression[] = [];
    for (const argument of params.statement.callExpression.arguments) {
      const bindArgumentResult = bindMethodArgumentExpression({
        expression: argument,
        refSymbolTable: params.refSymbolTable,
        stateSymbols: params.stateSymbols,
      });
      if (bindArgumentResult.ok === false) {
        return bindArgumentResult;
      }
      argumentResults.push(bindArgumentResult.expression);
    }

    const boundDo: BoundDoStatement = {
      kind: "do_statement",
      deviceAddress: resolveReceiverResult.deviceAddress,
      methodName: params.statement.callExpression.methodName,
      arguments: argumentResults,
      range: params.statement.range,
    };
    return { ok: true, boundStatement: boundDo };
  }

  if (params.statement.kind === "set_statement") {
    const definedState = params.stateSymbols.get(params.statement.stateName);
    if (definedState === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildNameUnknownReference({
            name: params.statement.stateName,
            range: astRangeToSourceRange(params.statement.range),
            rangeText: params.statement.stateName,
          }),
        ]),
      };
    }

    const bindValueResult = bindMethodArgumentExpression({
      expression: params.statement.valueExpression,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
    });
    if (bindValueResult.ok === false) {
      return bindValueResult;
    }

    const boundSet: BoundSetStatement = {
      kind: "set_statement",
      stateName: params.statement.stateName,
      valueExpression: bindValueResult.expression,
      range: params.statement.range,
    };
    return { ok: true, boundStatement: boundSet };
  }

  const boundWait: BoundWaitStatement = {
    kind: "wait_statement",
    waitMilliseconds: params.statement.waitMilliseconds,
    waitRange: params.statement.waitRange,
    range: params.statement.range,
  };
  return { ok: true, boundStatement: boundWait };
}

function resolveCallReceiverToDeviceAddress(params: {
  receiver: import("../ast/script-ast").CallReceiverAst;
  refSymbolTable: RefSymbolTable;
}): { ok: true; deviceAddress: DeviceAddress } | { ok: false; report: DiagnosticReport } {
  if (params.receiver.kind === "ref_receiver") {
    const symbolEntry = params.refSymbolTable.lookup(params.receiver.name);
    if (symbolEntry === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildNameUnknownReference({
            name: params.receiver.name,
            range: astRangeToSourceRange(params.receiver.range),
            rangeText: params.receiver.name,
          }),
        ]),
      };
    }
    return { ok: true, deviceAddress: symbolEntry.deviceAddress };
  }

  const parseAddressText = `${params.receiver.deviceKind}#${params.receiver.deviceId}`;
  const parseAddressResult = parseDeviceAddress(parseAddressText);
  if (parseAddressResult.ok === false) {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildNameUnknownReference({
          name: parseAddressText,
          range: astRangeToSourceRange(params.receiver.range),
          rangeText: parseAddressText,
        }),
      ]),
    };
  }

  return { ok: true, deviceAddress: parseAddressResult.address };
}

function bindReadTarget(params: {
  readTarget: ReadTargetAst;
}): { ok: true; expression: BoundExpression } | { ok: false; report: DiagnosticReport } {
  if (params.readTarget.kind !== "device_read") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildNameUnknownReference({
          name: "<read>",
          range: astRangeToSourceRange(params.readTarget.range),
        }),
      ]),
    };
  }

  const parseAddressText = `${params.readTarget.deviceKind}#${params.readTarget.deviceId}`;
  const parseAddressResult = parseDeviceAddress(parseAddressText);
  if (parseAddressResult.ok === false) {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildNameUnknownReference({
          name: parseAddressText,
          range: astRangeToSourceRange(params.readTarget.range),
          rangeText: parseAddressText,
        }),
      ]),
    };
  }

  const propertyName =
    params.readTarget.propertyName !== undefined && params.readTarget.propertyName !== ""
      ? params.readTarget.propertyName
      : "raw";

  const readExpression: BoundExpression = {
    kind: "read_property",
    deviceAddress: parseAddressResult.address,
    propertyName,
    range: params.readTarget.range,
  };

  return { ok: true, expression: readExpression };
}

function bindMethodArgumentExpression(params: {
  expression: MethodArgumentExpressionAst;
  refSymbolTable: RefSymbolTable;
  stateSymbols: Map<string, BoundStateSymbol>;
}): { ok: true; expression: BoundExpression } | { ok: false; report: DiagnosticReport } {
  if (params.expression.kind === "integer_literal") {
    return {
      ok: true,
      expression: { kind: "integer", value: params.expression.value },
    };
  }

  if (params.expression.kind === "string_literal") {
    return {
      ok: true,
      expression: { kind: "string", value: params.expression.value },
    };
  }

  if (params.expression.kind === "identifier_expression") {
    const stateBinding = params.stateSymbols.get(params.expression.name);
    if (stateBinding === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildNameUnknownReference({
            name: params.expression.name,
            range: astRangeToSourceRange(params.expression.range),
            rangeText: params.expression.name,
          }),
        ]),
      };
    }
    return {
      ok: true,
      expression: { kind: "identifier", name: params.expression.name },
    };
  }

  if (params.expression.kind === "binary_add") {
    const leftResult = bindMethodArgumentExpression({
      expression: params.expression.left,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
    });
    if (leftResult.ok === false) {
      return leftResult;
    }
    const rightResult = bindMethodArgumentExpression({
      expression: params.expression.right,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
    });
    if (rightResult.ok === false) {
      return rightResult;
    }
    return {
      ok: true,
      expression: {
        kind: "binary_add",
        left: leftResult.expression,
        right: rightResult.expression,
      },
    };
  }

  if (params.expression.kind === "read_expression") {
    const readResult = bindReadTarget({ readTarget: params.expression.readTarget });
    if (readResult.ok === false) {
      return readResult;
    }
    return { ok: true, expression: readResult.expression };
  }

  return {
    ok: false,
    report: createDiagnosticReport([
      buildNameUnknownReference({
        name: "<expression>",
        range: astRangeToSourceRange((params.expression as MethodArgumentExpressionAst).range),
      }),
    ]),
  };
}
