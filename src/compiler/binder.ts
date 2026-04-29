/**
 * AST を走査し ref / animator / state を解決し、task 本体の文をバインドする。
 */

import type {
  MethodArgumentExpressionAst,
  MatchNumericPatternAst,
  ProgramAst,
  ReadTargetAst,
  TaskOnEventTargetAst,
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
  buildBindCannotAssignToConst,
} from "../diagnostics/diagnostic-builder";
import type {
  BoundConstSymbol,
  BoundDoStatement,
  BoundAnimatorSymbol,
  BoundExpression,
  BoundEveryTask,
  BoundIfStatement,
  BoundLoopTask,
  BoundMatchPattern,
  BoundMatchStatement,
  BoundOnEventTask,
  BoundProgram,
  BoundRefSymbol,
  BoundSetStatement,
  BoundStatement,
  BoundStateSymbol,
  BoundTempStatement,
  BoundValueSymbolInSourceOrderRow,
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

  const animatorSymbols = new Map<string, BoundAnimatorSymbol>();
  const animatorSymbolsInSourceOrder: BoundAnimatorSymbol[] = [];

  for (const declaration of ast.declarations) {
    if (declaration.kind !== "animator_declaration") {
      continue;
    }

    const existingAnimator = animatorSymbols.get(declaration.animatorName);
    if (existingAnimator !== undefined) {
      diagnostics.push(
        buildNameDuplicateDeclaration({
          name: declaration.animatorName,
          range: astRangeToSourceRange(declaration.range),
          secondaryRange: astRangeToSourceRange(existingAnimator.range),
        }),
      );
      continue;
    }

    const ramp = declaration.ramp;
    const boundAnimator: BoundAnimatorSymbol =
      ramp.kind === "ramp_from_to"
        ? {
            animatorName: declaration.animatorName,
            rampKind: "from_to",
            fromPercent: ramp.fromPercent,
            toPercent: ramp.toPercent,
            fromPercentRange: ramp.fromPercentRange,
            toPercentRange: ramp.toPercentRange,
            durationValue: declaration.durationValue,
            durationUnit: declaration.durationUnit,
            durationRange: declaration.durationRange,
            easeName: declaration.easeName,
            easeRange: declaration.easeRange,
            range: declaration.range,
          }
        : {
            animatorName: declaration.animatorName,
            rampKind: "over_only",
            fromPercent: 0,
            toPercent: 0,
            fromPercentRange: declaration.range,
            toPercentRange: declaration.range,
            durationValue: declaration.durationValue,
            durationUnit: declaration.durationUnit,
            durationRange: declaration.durationRange,
            easeName: declaration.easeName,
            easeRange: declaration.easeRange,
            range: declaration.range,
          };
    animatorSymbols.set(declaration.animatorName, boundAnimator);
    animatorSymbolsInSourceOrder.push(boundAnimator);
  }

  if (diagnostics.length > 0) {
    return { ok: false, report: createDiagnosticReport(diagnostics) };
  }

  const constSymbols = new Map<string, BoundConstSymbol>();
  const constSymbolsInSourceOrder: BoundConstSymbol[] = [];
  const valueSymbolsInSourceOrder: BoundValueSymbolInSourceOrderRow[] = [];

  for (const declaration of ast.declarations) {
    if (declaration.kind === "state_declaration") {
      if (constSymbols.has(declaration.stateName)) {
        const existingConst = constSymbols.get(declaration.stateName)!;
        diagnostics.push(
          buildNameDuplicateDeclaration({
            name: declaration.stateName,
            range: astRangeToSourceRange(declaration.range),
            secondaryRange: astRangeToSourceRange(existingConst.range),
          }),
        );
        continue;
      }
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

      const bindExpressionResult = bindMethodArgumentExpression({
        expression: declaration.initialValueExpression,
        refSymbolTable,
        stateSymbols,
        constSymbols,
        animatorSymbols,
        tempNamesInScope: new Set(),
      });
      if (bindExpressionResult.ok === false) {
        return bindExpressionResult;
      }

      stateSymbols.set(declaration.stateName, {
        stateName: declaration.stateName,
        initialValue: bindExpressionResult.expression,
        range: declaration.range,
      });
      valueSymbolsInSourceOrder.push({
        kind: "state",
        name: declaration.stateName,
        initialValue: bindExpressionResult.expression,
        range: declaration.range,
      });
      continue;
    }

    if (declaration.kind === "const_declaration") {
      if (stateSymbols.has(declaration.constName)) {
        const existingState = stateSymbols.get(declaration.constName)!;
        diagnostics.push(
          buildNameDuplicateDeclaration({
            name: declaration.constName,
            range: astRangeToSourceRange(declaration.range),
            secondaryRange: astRangeToSourceRange(existingState.range),
          }),
        );
        continue;
      }
      const existingConst = constSymbols.get(declaration.constName);
      if (existingConst !== undefined) {
        diagnostics.push(
          buildNameDuplicateDeclaration({
            name: declaration.constName,
            range: astRangeToSourceRange(declaration.range),
            secondaryRange: astRangeToSourceRange(existingConst.range),
          }),
        );
        continue;
      }

      const bindExpressionResult = bindMethodArgumentExpression({
        expression: declaration.initialValueExpression,
        refSymbolTable,
        stateSymbols,
        constSymbols,
        animatorSymbols,
        tempNamesInScope: new Set(),
      });
      if (bindExpressionResult.ok === false) {
        return bindExpressionResult;
      }

      const constSymbol: BoundConstSymbol = {
        constName: declaration.constName,
        initialValue: bindExpressionResult.expression,
        range: declaration.range,
      };
      constSymbols.set(declaration.constName, constSymbol);
      constSymbolsInSourceOrder.push(constSymbol);
      valueSymbolsInSourceOrder.push({
        kind: "const",
        name: declaration.constName,
        initialValue: bindExpressionResult.expression,
        range: declaration.range,
      });
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, report: createDiagnosticReport(diagnostics) };
  }

  const boundEveryTasks: BoundEveryTask[] = [];
  const boundLoopTasks: BoundLoopTask[] = [];
  const boundOnEventTasks: BoundOnEventTask[] = [];

  for (const declaration of ast.declarations) {
    if (declaration.kind === "task_declaration") {
      const bindTaskResult = bindTaskDeclaration({
        taskDeclaration: declaration,
        refSymbolTable,
        stateSymbols,
        constSymbols,
        animatorSymbols,
      });
      if (bindTaskResult.ok === false) {
        return bindTaskResult;
      }
      if (bindTaskResult.boundTask.runKind === "every") {
        boundEveryTasks.push(bindTaskResult.boundTask);
        continue;
      }
      boundLoopTasks.push(bindTaskResult.boundTask);
      continue;
    }

    if (declaration.kind === "task_on_declaration") {
      const bindOnResult = bindTaskOnDeclaration({
        taskOnDeclaration: declaration,
        refSymbolTable,
        stateSymbols,
        constSymbols,
        animatorSymbols,
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
    constSymbols,
    constSymbolsInSourceOrder,
    stateSymbolsInSourceOrder: buildStateSymbolsInSourceOrder(ast, stateSymbols),
    animatorSymbols,
    animatorSymbolsInSourceOrder,
    everyTasks: boundEveryTasks,
    loopTasks: boundLoopTasks,
    onEventTasks: boundOnEventTasks,
    valueSymbolsInSourceOrder,
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
  constSymbols: Map<string, BoundConstSymbol>;
  animatorSymbols: ReadonlyMap<string, BoundAnimatorSymbol>;
}): { ok: true; boundTask: BoundEveryTask | BoundLoopTask } | { ok: false; report: DiagnosticReport } {
  const linearTempScope = new Set<string>();
  const boundStatements: BoundStatement[] = [];

  for (const statement of params.taskDeclaration.bodyStatements) {
    const bindStatementResult = bindStatement({
      statement,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
      constSymbols: params.constSymbols,
      animatorSymbols: params.animatorSymbols,
      tempNamesInScope: linearTempScope,
    });
    if (bindStatementResult.ok === false) {
      return bindStatementResult;
    }
    boundStatements.push(bindStatementResult.boundStatement);
    if (statement.kind === "temp_statement") {
      linearTempScope.add(statement.tempName);
    }
  }

  if (params.taskDeclaration.schedule.kind === "every") {
    const schedule = params.taskDeclaration.schedule;
    const boundTask: BoundEveryTask = {
      runKind: "every",
      taskName: params.taskDeclaration.taskName,
      intervalValue: schedule.intervalValue,
      intervalUnit: schedule.intervalUnit,
      intervalRange: schedule.intervalRange,
      statements: boundStatements,
      range: params.taskDeclaration.range,
    };
    return { ok: true, boundTask };
  }

  const boundLoopTask: BoundLoopTask = {
    runKind: "loop",
    taskName: params.taskDeclaration.taskName,
    statements: boundStatements,
    range: params.taskDeclaration.range,
  };

  return { ok: true, boundTask: boundLoopTask };
}

function bindTaskOnDeclaration(params: {
  taskOnDeclaration: TaskOnDeclarationAst;
  refSymbolTable: RefSymbolTable;
  stateSymbols: Map<string, BoundStateSymbol>;
  constSymbols: Map<string, BoundConstSymbol>;
  animatorSymbols: ReadonlyMap<string, BoundAnimatorSymbol>;
}): { ok: true; boundTask: BoundOnEventTask } | { ok: false; report: DiagnosticReport } {
  const resolveEventTargetResult = resolveTaskOnEventTargetToDeviceAddress({
    eventTarget: params.taskOnDeclaration.eventTarget,
    refSymbolTable: params.refSymbolTable,
  });
  if (resolveEventTargetResult.ok === false) {
    return resolveEventTargetResult;
  }

  const linearTempScope = new Set<string>();
  const boundStatements: BoundStatement[] = [];

  for (const statement of params.taskOnDeclaration.bodyStatements) {
    const bindStatementResult = bindStatement({
      statement,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
      constSymbols: params.constSymbols,
      animatorSymbols: params.animatorSymbols,
      tempNamesInScope: linearTempScope,
    });
    if (bindStatementResult.ok === false) {
      return bindStatementResult;
    }
    boundStatements.push(bindStatementResult.boundStatement);
    if (statement.kind === "temp_statement") {
      linearTempScope.add(statement.tempName);
    }
  }

  const boundTask: BoundOnEventTask = {
    taskName: params.taskOnDeclaration.taskName,
    deviceAddress: resolveEventTargetResult.deviceAddress,
    eventName: params.taskOnDeclaration.eventName,
    statements: boundStatements,
    range: params.taskOnDeclaration.range,
  };

  return { ok: true, boundTask };
}

function resolveTaskOnEventTargetToDeviceAddress(params: {
  eventTarget: TaskOnEventTargetAst;
  refSymbolTable: RefSymbolTable;
}): { ok: true; deviceAddress: DeviceAddress } | { ok: false; report: DiagnosticReport } {
  if (params.eventTarget.kind === "ref_event_target") {
    const symbolEntry = params.refSymbolTable.lookup(params.eventTarget.name);
    if (symbolEntry === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildNameUnknownReference({
            name: params.eventTarget.name,
            range: astRangeToSourceRange(params.eventTarget.range),
            rangeText: params.eventTarget.name,
          }),
        ]),
      };
    }
    return { ok: true, deviceAddress: symbolEntry.deviceAddress };
  }

  const deviceReferenceText = `${params.eventTarget.deviceKind}#${params.eventTarget.deviceId}`;
  const parseAddressResult = parseDeviceAddress(deviceReferenceText);
  if (parseAddressResult.ok === false) {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildNameUnknownReference({
          name: deviceReferenceText,
          range: astRangeToSourceRange(params.eventTarget.range),
          rangeText: deviceReferenceText,
        }),
      ]),
    };
  }

  return { ok: true, deviceAddress: parseAddressResult.address };
}

function bindStatementSequence(params: {
  statements: import("../ast/script-ast").StatementAst[];
  refSymbolTable: RefSymbolTable;
  stateSymbols: Map<string, BoundStateSymbol>;
  constSymbols: Map<string, BoundConstSymbol>;
  animatorSymbols: ReadonlyMap<string, BoundAnimatorSymbol>;
  inheritedTempNames: Set<string>;
}): { ok: true; boundStatements: BoundStatement[] } | { ok: false; report: DiagnosticReport } {
  const linearTempScope = new Set(params.inheritedTempNames);
  const boundStatements: BoundStatement[] = [];

  for (const statement of params.statements) {
    const bindStatementResult = bindStatement({
      statement,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
      constSymbols: params.constSymbols,
      animatorSymbols: params.animatorSymbols,
      tempNamesInScope: linearTempScope,
    });
    if (bindStatementResult.ok === false) {
      return bindStatementResult;
    }
    boundStatements.push(bindStatementResult.boundStatement);
    if (statement.kind === "temp_statement") {
      linearTempScope.add(statement.tempName);
    }
  }

  return { ok: true, boundStatements };
}

function bindStatement(params: {
  statement: import("../ast/script-ast").StatementAst;
  refSymbolTable: RefSymbolTable;
  stateSymbols: Map<string, BoundStateSymbol>;
  constSymbols: Map<string, BoundConstSymbol>;
  animatorSymbols: ReadonlyMap<string, BoundAnimatorSymbol>;
  tempNamesInScope: Set<string>;
}): { ok: true; boundStatement: BoundStatement } | { ok: false; report: DiagnosticReport } {
  const expressionBindContext = {
    refSymbolTable: params.refSymbolTable,
    stateSymbols: params.stateSymbols,
    constSymbols: params.constSymbols,
    animatorSymbols: params.animatorSymbols,
    tempNamesInScope: params.tempNamesInScope,
  };

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
        ...expressionBindContext,
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
    if (params.constSymbols.has(params.statement.stateName)) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildBindCannotAssignToConst({
            name: params.statement.stateName,
            range: astRangeToSourceRange(params.statement.range),
          }),
        ]),
      };
    }

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
      ...expressionBindContext,
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

  if (params.statement.kind === "wait_statement") {
    const bindDurationResult = bindMethodArgumentExpression({
      expression: params.statement.durationMillisecondsExpression,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
      constSymbols: params.constSymbols,
      animatorSymbols: params.animatorSymbols,
      tempNamesInScope: params.tempNamesInScope,
    });
    if (bindDurationResult.ok === false) {
      return bindDurationResult;
    }

    const boundWait: BoundWaitStatement = {
      kind: "wait_statement",
      durationMillisecondsExpression: bindDurationResult.expression,
      waitRange: params.statement.waitRange,
      range: params.statement.range,
    };
    return { ok: true, boundStatement: boundWait };
  }

  if (params.statement.kind === "temp_statement") {
    const bindValueResult = bindMethodArgumentExpression({
      expression: params.statement.valueExpression,
      ...expressionBindContext,
    });
    if (bindValueResult.ok === false) {
      return bindValueResult;
    }

    const boundTemp: BoundTempStatement = {
      kind: "temp_statement",
      range: params.statement.range,
      tempName: params.statement.tempName,
      valueExpression: bindValueResult.expression,
    };
    return { ok: true, boundStatement: boundTemp };
  }

  if (params.statement.kind === "if_statement") {
    const bindConditionResult = bindMethodArgumentExpression({
      expression: params.statement.conditionExpression,
      ...expressionBindContext,
    });
    if (bindConditionResult.ok === false) {
      return bindConditionResult;
    }

    const inheritedScopeSnapshot = new Set(params.tempNamesInScope);

    const thenSequenceResult = bindStatementSequence({
      statements: params.statement.thenBodyStatements,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
      constSymbols: params.constSymbols,
      animatorSymbols: params.animatorSymbols,
      inheritedTempNames: inheritedScopeSnapshot,
    });
    if (thenSequenceResult.ok === false) {
      return thenSequenceResult;
    }

    const elseSequenceResult = bindStatementSequence({
      statements: params.statement.elseBodyStatements,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
      constSymbols: params.constSymbols,
      animatorSymbols: params.animatorSymbols,
      inheritedTempNames: inheritedScopeSnapshot,
    });
    if (elseSequenceResult.ok === false) {
      return elseSequenceResult;
    }

    const boundIf: BoundIfStatement = {
      kind: "if_statement",
      range: params.statement.range,
      conditionExpression: bindConditionResult.expression,
      thenStatements: thenSequenceResult.boundStatements,
      elseStatements: elseSequenceResult.boundStatements,
    };
    return { ok: true, boundStatement: boundIf };
  }

  if (params.statement.kind === "match_statement") {
    const bindTargetResult = bindMethodArgumentExpression({
      expression: params.statement.matchTargetExpression,
      ...expressionBindContext,
    });
    if (bindTargetResult.ok === false) {
      return bindTargetResult;
    }

    const scopeBeforeMatchArms = new Set(params.tempNamesInScope);

    const stringCases: {
      patternString: string;
      statements: BoundStatement[];
    }[] = [];

    for (const caseAst of params.statement.stringCases) {
      const branchSequenceResult = bindStatementSequence({
        statements: caseAst.bodyStatements,
        refSymbolTable: params.refSymbolTable,
        stateSymbols: params.stateSymbols,
        constSymbols: params.constSymbols,
        animatorSymbols: params.animatorSymbols,
        inheritedTempNames: scopeBeforeMatchArms,
      });
      if (branchSequenceResult.ok === false) {
        return branchSequenceResult;
      }
      stringCases.push({
        patternString: caseAst.patternStringLiteral,
        statements: branchSequenceResult.boundStatements,
      });
    }

    const elseSequenceResult = bindStatementSequence({
      statements: params.statement.elseBodyStatements,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
      constSymbols: params.constSymbols,
      animatorSymbols: params.animatorSymbols,
      inheritedTempNames: scopeBeforeMatchArms,
    });
    if (elseSequenceResult.ok === false) {
      return elseSequenceResult;
    }

    const boundMatch: BoundMatchStatement = {
      kind: "match_statement",
      range: params.statement.range,
      matchExpression: bindTargetResult.expression,
      stringCases,
      elseStatements: elseSequenceResult.boundStatements,
    };

    return { ok: true, boundStatement: boundMatch };
  }

  return {
    ok: false,
    report: createDiagnosticReport([
      buildNameUnknownReference({
        name: "<statement>",
        range: astRangeToSourceRange(
          (params.statement as import("../ast/script-ast").StatementAst).range,
        ),
      }),
    ]),
  };
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

function resolveDefaultReadPropertyName(params: {
  deviceAddress: DeviceAddress;
  explicitPropertyName: string | undefined;
}): string {
  const hasExplicitProperty =
    params.explicitPropertyName !== undefined && params.explicitPropertyName !== "";
  if (hasExplicitProperty) {
    return params.explicitPropertyName ?? "";
  }
  if (params.deviceAddress.kind === "adc") {
    return "raw";
  }
  if (params.deviceAddress.kind === "motor") {
    return "power";
  }
  if (params.deviceAddress.kind === "servo") {
    return "angle";
  }
  if (params.deviceAddress.kind === "pwm") {
    return "level";
  }
  if (params.deviceAddress.kind === "imu") {
    return "roll";
  }
  return "";
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

  const propertyName = resolveDefaultReadPropertyName({
    deviceAddress: parseAddressResult.address,
    explicitPropertyName: params.readTarget.propertyName,
  });

  const readExpression: BoundExpression = {
    kind: "read_property",
    deviceAddress: parseAddressResult.address,
    propertyName,
    range: params.readTarget.range,
  };

  return { ok: true, expression: readExpression };
}

function bindMatchNumericPatternFromAst(params: {
  pattern: MatchNumericPatternAst;
  refSymbolTable: RefSymbolTable;
  stateSymbols: Map<string, BoundStateSymbol>;
  constSymbols: Map<string, BoundConstSymbol>;
  animatorSymbols: ReadonlyMap<string, BoundAnimatorSymbol>;
  tempNamesInScope: Set<string>;
}): { ok: true; boundPattern: BoundMatchPattern } | { ok: false; report: DiagnosticReport } {
  if (params.pattern.kind === "equality_pattern") {
    const bindCompareResult = bindMethodArgumentExpression({
      expression: params.pattern.compareExpression,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
      constSymbols: params.constSymbols,
      animatorSymbols: params.animatorSymbols,
      tempNamesInScope: params.tempNamesInScope,
    });
    if (bindCompareResult.ok === false) {
      return bindCompareResult;
    }
    return {
      ok: true,
      boundPattern: {
        kind: "equality_pattern",
        range: params.pattern.range,
        compareExpression: bindCompareResult.expression,
      },
    };
  }

  let startInclusive: BoundExpression | undefined;
  if (params.pattern.startInclusive !== undefined) {
    const bindStartResult = bindMethodArgumentExpression({
      expression: params.pattern.startInclusive,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
      constSymbols: params.constSymbols,
      animatorSymbols: params.animatorSymbols,
      tempNamesInScope: params.tempNamesInScope,
    });
    if (bindStartResult.ok === false) {
      return bindStartResult;
    }
    startInclusive = bindStartResult.expression;
  }

  let endExclusive: BoundExpression | undefined;
  if (params.pattern.endExclusive !== undefined) {
    const bindEndResult = bindMethodArgumentExpression({
      expression: params.pattern.endExclusive,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
      constSymbols: params.constSymbols,
      animatorSymbols: params.animatorSymbols,
      tempNamesInScope: params.tempNamesInScope,
    });
    if (bindEndResult.ok === false) {
      return bindEndResult;
    }
    endExclusive = bindEndResult.expression;
  }

  return {
    ok: true,
    boundPattern: {
      kind: "range_pattern",
      range: params.pattern.range,
      startInclusive,
      endExclusive,
    },
  };
}

function bindMethodArgumentExpression(params: {
  expression: MethodArgumentExpressionAst;
  refSymbolTable: RefSymbolTable;
  stateSymbols: Map<string, BoundStateSymbol>;
  constSymbols: Map<string, BoundConstSymbol>;
  animatorSymbols: ReadonlyMap<string, BoundAnimatorSymbol>;
  tempNamesInScope: Set<string>;
}): { ok: true; expression: BoundExpression } | { ok: false; report: DiagnosticReport } {
  const bindRecursive = (
    expression: MethodArgumentExpressionAst,
  ): { ok: true; expression: BoundExpression } | { ok: false; report: DiagnosticReport } =>
    bindMethodArgumentExpression({
      expression,
      refSymbolTable: params.refSymbolTable,
      stateSymbols: params.stateSymbols,
      constSymbols: params.constSymbols,
      animatorSymbols: params.animatorSymbols,
      tempNamesInScope: params.tempNamesInScope,
    });

  if (params.expression.kind === "integer_literal") {
    return {
      ok: true,
      expression: { kind: "integer", value: params.expression.value },
    };
  }

  if (params.expression.kind === "percent_literal") {
    return {
      ok: true,
      expression: {
        kind: "percent",
        value: params.expression.value,
        range: params.expression.range,
      },
    };
  }

  if (params.expression.kind === "dt_expression") {
    return {
      ok: true,
      expression: { kind: "dt_reference", range: params.expression.range },
    };
  }

  if (params.expression.kind === "step_animator_expression") {
    if (!params.animatorSymbols.has(params.expression.animatorName)) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildNameUnknownReference({
            name: params.expression.animatorName,
            range: astRangeToSourceRange(params.expression.range),
            rangeText: params.expression.animatorName,
          }),
        ]),
      };
    }

    if (params.expression.targetExpression !== undefined) {
      const targetBindResult = bindRecursive(params.expression.targetExpression);
      if (targetBindResult.ok === false) {
        return targetBindResult;
      }
      return {
        ok: true,
        expression: {
          kind: "step_animator",
          animatorName: params.expression.animatorName,
          range: params.expression.range,
          targetExpression: targetBindResult.expression,
        },
      };
    }

    return {
      ok: true,
      expression: {
        kind: "step_animator",
        animatorName: params.expression.animatorName,
        range: params.expression.range,
      },
    };
  }

  if (params.expression.kind === "string_literal") {
    return {
      ok: true,
      expression: { kind: "string", value: params.expression.value },
    };
  }

  if (params.expression.kind === "identifier_expression") {
    const name = params.expression.name;
    if (params.tempNamesInScope.has(name)) {
      return {
        ok: true,
        expression: { kind: "temp_reference", tempName: name },
      };
    }
    if (params.constSymbols.has(name)) {
      return {
        ok: true,
        expression: { kind: "const_reference", constName: name },
      };
    }
    const stateBinding = params.stateSymbols.get(name);
    if (stateBinding === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildNameUnknownReference({
            name,
            range: astRangeToSourceRange(params.expression.range),
            rangeText: name,
          }),
        ]),
      };
    }
    return {
      ok: true,
      expression: { kind: "identifier", name },
    };
  }

  if (params.expression.kind === "binary_add") {
    const leftResult = bindRecursive(params.expression.left);
    if (leftResult.ok === false) {
      return leftResult;
    }
    const rightResult = bindRecursive(params.expression.right);
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

  if (params.expression.kind === "binary_sub") {
    const leftResult = bindRecursive(params.expression.left);
    if (leftResult.ok === false) {
      return leftResult;
    }
    const rightResult = bindRecursive(params.expression.right);
    if (rightResult.ok === false) {
      return rightResult;
    }
    return {
      ok: true,
      expression: {
        kind: "binary_sub",
        left: leftResult.expression,
        right: rightResult.expression,
      },
    };
  }

  if (params.expression.kind === "binary_mul") {
    const leftResult = bindRecursive(params.expression.left);
    if (leftResult.ok === false) {
      return leftResult;
    }
    const rightResult = bindRecursive(params.expression.right);
    if (rightResult.ok === false) {
      return rightResult;
    }
    return {
      ok: true,
      expression: {
        kind: "binary_mul",
        left: leftResult.expression,
        right: rightResult.expression,
      },
    };
  }

  if (params.expression.kind === "binary_div") {
    const leftResult = bindRecursive(params.expression.left);
    if (leftResult.ok === false) {
      return leftResult;
    }
    const rightResult = bindRecursive(params.expression.right);
    if (rightResult.ok === false) {
      return rightResult;
    }
    return {
      ok: true,
      expression: {
        kind: "binary_div",
        left: leftResult.expression,
        right: rightResult.expression,
      },
    };
  }

  if (params.expression.kind === "unary_minus") {
    const operandResult = bindRecursive(params.expression.operand);
    if (operandResult.ok === false) {
      return operandResult;
    }
    return {
      ok: true,
      expression: {
        kind: "unary_minus",
        operand: operandResult.expression,
      },
    };
  }

  if (params.expression.kind === "comparison") {
    const leftResult = bindRecursive(params.expression.left);
    if (leftResult.ok === false) {
      return leftResult;
    }
    const rightResult = bindRecursive(params.expression.right);
    if (rightResult.ok === false) {
      return rightResult;
    }
    return {
      ok: true,
      expression: {
        kind: "comparison",
        operator: params.expression.operator,
        left: leftResult.expression,
        right: rightResult.expression,
      },
    };
  }

  if (params.expression.kind === "match_expression") {
    const scrutineeResult = bindRecursive(params.expression.scrutinee);
    if (scrutineeResult.ok === false) {
      return scrutineeResult;
    }

    const boundArms: {
      pattern: BoundMatchPattern;
      resultExpression: BoundExpression;
      range: import("../ast/script-ast").AstRange;
    }[] = [];

    for (const arm of params.expression.arms) {
      const patternResult = bindMatchNumericPatternFromAst({
        pattern: arm.pattern,
        refSymbolTable: params.refSymbolTable,
        stateSymbols: params.stateSymbols,
        constSymbols: params.constSymbols,
        animatorSymbols: params.animatorSymbols,
        tempNamesInScope: params.tempNamesInScope,
      });
      if (patternResult.ok === false) {
        return patternResult;
      }
      const resultResult = bindRecursive(arm.resultExpression);
      if (resultResult.ok === false) {
        return resultResult;
      }
      boundArms.push({
        pattern: patternResult.boundPattern,
        resultExpression: resultResult.expression,
        range: arm.range,
      });
    }

    let elseResultExpression: BoundExpression | undefined;
    if (params.expression.elseResultExpression !== undefined) {
      const elseBind = bindRecursive(params.expression.elseResultExpression);
      if (elseBind.ok === false) {
        return elseBind;
      }
      elseResultExpression = elseBind.expression;
    }

    return {
      ok: true,
      expression: {
        kind: "match_expression",
        range: params.expression.range,
        scrutinee: scrutineeResult.expression,
        arms: boundArms,
        elseResultExpression,
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
