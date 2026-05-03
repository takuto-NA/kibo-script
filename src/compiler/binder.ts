/**
 * AST を走査し ref / animator / var を解決し、task 本体の文をバインドする。
 */

import type {
  MethodArgumentExpressionAst,
  MatchNumericPatternAst,
  ProgramAst,
  ReadTargetAst,
  TaskOnEventTargetAst,
  TaskOnDeclarationAst,
  TaskDeclarationAst,
  StateMachineDeclarationAst,
  TaskStateMembershipAst,
} from "../ast/script-ast";
import { parseDeviceAddress } from "../core/device-address";
import type { DeviceAddress } from "../core/device-address";
import type { DiagnosticReport, SourceRange } from "../diagnostics/diagnostic";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import {
  buildNameDuplicateDeclaration,
  buildNameUnknownReference,
  buildBindCannotAssignToConst,
  buildSemanticDuplicateStateMachineName,
  buildSemanticInvalidStateMachineTransitionTarget,
  buildSemanticCompositeStateRequiresInitialChild,
  buildSemanticUnresolvedInitialLeafPath,
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
  BoundVarSymbol,
  BoundTempStatement,
  BoundValueSymbolInSourceOrderRow,
  BoundWaitStatement,
  BoundStateMachineDefinition,
  BoundStateMachineNode,
  BoundStateMachineTransition,
  BoundTaskStateMembership,
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

function createAmbientSyntheticAstRange(sourceFileName: string): import("../ast/script-ast").AstRange {
  const zeroPosition = { line: 1, column: 1, offset: 0 };
  return {
    fileName: sourceFileName,
    start: zeroPosition,
    end: zeroPosition,
  };
}

export type BindProgramAmbientWorld = {
  /**
   * 既に runtime に登録済みの ref（追加コンパイル時に script 側で `ref` 宣言なしで参照する）。
   */
  readonly existingRefDeviceAddressesByName: ReadonlyMap<string, DeviceAddress>;
  readonly existingAmbientVarNames: readonly string[];
  readonly existingAmbientConstNames: readonly string[];
};

export function bindProgram(
  ast: ProgramAst,
  sourceFileName: string,
  ambientWorld?: BindProgramAmbientWorld,
): BindProgramResult {
  const refSymbolTable = new RefSymbolTable();
  const varSymbols = new Map<string, BoundVarSymbol>();
  const diagnostics: DiagnosticReport["diagnostics"] = [];
  const sourceDeclaredRefNames = new Set<string>();

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
    } else {
      sourceDeclaredRefNames.add(declaration.symbolName);
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, report: createDiagnosticReport(diagnostics) };
  }

  const ambientSyntheticAstRange = createAmbientSyntheticAstRange(sourceFileName);
  for (const [symbolName, deviceAddress] of ambientWorld?.existingRefDeviceAddressesByName ?? []) {
    if (refSymbolTable.lookup(symbolName) !== undefined) {
      continue;
    }
    refSymbolTable.tryRegister({
      symbolName,
      deviceAddress,
      declarationRange: ambientSyntheticAstRange,
    });
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
    if (declaration.kind === "var_declaration") {
      if (constSymbols.has(declaration.varName)) {
        const existingConst = constSymbols.get(declaration.varName)!;
        diagnostics.push(
          buildNameDuplicateDeclaration({
            name: declaration.varName,
            range: astRangeToSourceRange(declaration.range),
            secondaryRange: astRangeToSourceRange(existingConst.range),
          }),
        );
        continue;
      }
      const existingVar = varSymbols.get(declaration.varName);
      if (existingVar !== undefined) {
        diagnostics.push(
          buildNameDuplicateDeclaration({
            name: declaration.varName,
            range: astRangeToSourceRange(declaration.range),
            secondaryRange: astRangeToSourceRange(existingVar.range),
          }),
        );
        continue;
      }

      const bindExpressionResult = bindMethodArgumentExpression({
        expression: declaration.initialValueExpression,
        refSymbolTable,
        varSymbols,
        constSymbols,
        animatorSymbols,
        tempNamesInScope: new Set(),
      });
      if (bindExpressionResult.ok === false) {
        return bindExpressionResult;
      }

      varSymbols.set(declaration.varName, {
        varName: declaration.varName,
        initialValue: bindExpressionResult.expression,
        range: declaration.range,
      });
      valueSymbolsInSourceOrder.push({
        kind: "var",
        name: declaration.varName,
        initialValue: bindExpressionResult.expression,
        range: declaration.range,
      });
      continue;
    }

    if (declaration.kind === "const_declaration") {
      if (varSymbols.has(declaration.constName)) {
        const existingVar = varSymbols.get(declaration.constName)!;
        diagnostics.push(
          buildNameDuplicateDeclaration({
            name: declaration.constName,
            range: astRangeToSourceRange(declaration.range),
            secondaryRange: astRangeToSourceRange(existingVar.range),
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
        varSymbols,
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

  for (const ambientVarName of ambientWorld?.existingAmbientVarNames ?? []) {
    if (varSymbols.has(ambientVarName) || constSymbols.has(ambientVarName)) {
      continue;
    }
    varSymbols.set(ambientVarName, {
      varName: ambientVarName,
      initialValue: { kind: "integer", value: 0 },
      range: ambientSyntheticAstRange,
    });
  }

  for (const ambientConstName of ambientWorld?.existingAmbientConstNames ?? []) {
    if (varSymbols.has(ambientConstName) || constSymbols.has(ambientConstName)) {
      continue;
    }
    const ambientConstSymbol: BoundConstSymbol = {
      constName: ambientConstName,
      initialValue: { kind: "integer", value: 0 },
      range: ambientSyntheticAstRange,
    };
    constSymbols.set(ambientConstName, ambientConstSymbol);
    constSymbolsInSourceOrder.push(ambientConstSymbol);
  }

  if (diagnostics.length > 0) {
    return { ok: false, report: createDiagnosticReport(diagnostics) };
  }

  const stateMachinesInSourceOrder: BoundStateMachineDefinition[] = [];
  const firstStateMachineDeclarationRangeByMachineName = new Map<
    string,
    import("../ast/script-ast").AstRange
  >();
  for (const declaration of ast.declarations) {
    if (declaration.kind !== "state_machine_declaration") {
      continue;
    }
    const earlierRange = firstStateMachineDeclarationRangeByMachineName.get(declaration.machineName);
    if (earlierRange !== undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildSemanticDuplicateStateMachineName({
            name: declaration.machineName,
            range: astRangeToSourceRange(declaration.range),
            secondaryRange: astRangeToSourceRange(earlierRange),
          }),
        ]),
      };
    }
    firstStateMachineDeclarationRangeByMachineName.set(declaration.machineName, declaration.range);
    const smBindResult = bindStateMachineDeclarationAst({
      declaration,
      refSymbolTable,
      varSymbols,
      constSymbols,
      animatorSymbols,
    });
    if (smBindResult.ok === false) {
      return smBindResult;
    }
    stateMachinesInSourceOrder.push(smBindResult.definition);
  }

  const boundEveryTasks: BoundEveryTask[] = [];
  const boundLoopTasks: BoundLoopTask[] = [];
  const boundOnEventTasks: BoundOnEventTask[] = [];

  for (const declaration of ast.declarations) {
    if (declaration.kind === "task_declaration") {
      const bindTaskResult = bindTaskDeclaration({
        taskDeclaration: declaration,
        refSymbolTable,
        varSymbols,
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
        varSymbols,
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
    sourceDeclaredRefNames,
    varSymbols,
    constSymbols,
    constSymbolsInSourceOrder,
    varSymbolsInSourceOrder: buildVarSymbolsInSourceOrder(ast, varSymbols),
    animatorSymbols,
    animatorSymbolsInSourceOrder,
    everyTasks: boundEveryTasks,
    loopTasks: boundLoopTasks,
    onEventTasks: boundOnEventTasks,
    valueSymbolsInSourceOrder,
    stateMachinesInSourceOrder,
  };

  return { ok: true, boundProgram };
}

function buildVarSymbolsInSourceOrder(
  ast: ProgramAst,
  varSymbols: Map<string, BoundVarSymbol>,
): BoundVarSymbol[] {
  const ordered: BoundVarSymbol[] = [];
  for (const declaration of ast.declarations) {
    if (declaration.kind !== "var_declaration") {
      continue;
    }
    const symbol = varSymbols.get(declaration.varName);
    if (symbol !== undefined) {
      ordered.push(symbol);
    }
  }
  return ordered;
}

function bindTaskStateMembershipAst(astMembership: TaskStateMembershipAst): BoundTaskStateMembership {
  if (astMembership.kind === "none") {
    return { kind: "none" };
  }
  return {
    kind: "in_state_path",
    statePathText: astMembership.statePathText,
    range: astMembership.statePathRange,
  };
}

function bindTaskDeclaration(params: {
  taskDeclaration: TaskDeclarationAst;
  refSymbolTable: RefSymbolTable;
  varSymbols: Map<string, BoundVarSymbol>;
  constSymbols: Map<string, BoundConstSymbol>;
  animatorSymbols: ReadonlyMap<string, BoundAnimatorSymbol>;
}): { ok: true; boundTask: BoundEveryTask | BoundLoopTask } | { ok: false; report: DiagnosticReport } {
  const linearTempScope = new Set<string>();
  const boundStatements: BoundStatement[] = [];
  const stateMembership = bindTaskStateMembershipAst(params.taskDeclaration.stateMembership);

  for (const statement of params.taskDeclaration.bodyStatements) {
    const bindStatementResult = bindStatement({
      statement,
      refSymbolTable: params.refSymbolTable,
      varSymbols: params.varSymbols,
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
      stateMembership,
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
    stateMembership,
    statements: boundStatements,
    range: params.taskDeclaration.range,
  };

  return { ok: true, boundTask: boundLoopTask };
}

function bindTaskOnDeclaration(params: {
  taskOnDeclaration: TaskOnDeclarationAst;
  refSymbolTable: RefSymbolTable;
  varSymbols: Map<string, BoundVarSymbol>;
  constSymbols: Map<string, BoundConstSymbol>;
  animatorSymbols: ReadonlyMap<string, BoundAnimatorSymbol>;
}): { ok: true; boundTask: BoundOnEventTask } | { ok: false; report: DiagnosticReport } {
  const stateMembership = bindTaskStateMembershipAst(params.taskOnDeclaration.stateMembership);

  const linearTempScope = new Set<string>();
  const boundStatements: BoundStatement[] = [];

  for (const statement of params.taskOnDeclaration.bodyStatements) {
    const bindStatementResult = bindStatement({
      statement,
      refSymbolTable: params.refSymbolTable,
      varSymbols: params.varSymbols,
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

  const trigger = params.taskOnDeclaration.trigger;
  if (trigger.kind === "state_lifecycle") {
    const boundTask: BoundOnEventTask = {
      taskName: params.taskOnDeclaration.taskName,
      stateMembership,
      trigger: { kind: "state_lifecycle", lifecycle: trigger.lifecycle },
      statements: boundStatements,
      range: params.taskOnDeclaration.range,
    };
    return { ok: true, boundTask };
  }

  const resolveEventTargetResult = resolveTaskOnEventTargetToDeviceAddress({
    eventTarget: trigger.eventTarget,
    refSymbolTable: params.refSymbolTable,
  });
  if (resolveEventTargetResult.ok === false) {
    return resolveEventTargetResult;
  }

  const boundTask: BoundOnEventTask = {
    taskName: params.taskOnDeclaration.taskName,
    stateMembership,
    trigger: {
      kind: "device_event",
      deviceAddress: resolveEventTargetResult.deviceAddress,
      eventName: trigger.eventName,
    },
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
  varSymbols: Map<string, BoundVarSymbol>;
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
      varSymbols: params.varSymbols,
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
  varSymbols: Map<string, BoundVarSymbol>;
  constSymbols: Map<string, BoundConstSymbol>;
  animatorSymbols: ReadonlyMap<string, BoundAnimatorSymbol>;
  tempNamesInScope: Set<string>;
}): { ok: true; boundStatement: BoundStatement } | { ok: false; report: DiagnosticReport } {
  const expressionBindContext = {
    refSymbolTable: params.refSymbolTable,
    varSymbols: params.varSymbols,
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
    if (params.constSymbols.has(params.statement.varName)) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildBindCannotAssignToConst({
            name: params.statement.varName,
            range: astRangeToSourceRange(params.statement.range),
          }),
        ]),
      };
    }

    const definedVar = params.varSymbols.get(params.statement.varName);
    if (definedVar === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildNameUnknownReference({
            name: params.statement.varName,
            range: astRangeToSourceRange(params.statement.range),
            rangeText: params.statement.varName,
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
      varName: params.statement.varName,
      valueExpression: bindValueResult.expression,
      range: params.statement.range,
    };
    return { ok: true, boundStatement: boundSet };
  }

  if (params.statement.kind === "wait_statement") {
    const bindDurationResult = bindMethodArgumentExpression({
      expression: params.statement.durationMillisecondsExpression,
      refSymbolTable: params.refSymbolTable,
      varSymbols: params.varSymbols,
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
      varSymbols: params.varSymbols,
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
      varSymbols: params.varSymbols,
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
        varSymbols: params.varSymbols,
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
      varSymbols: params.varSymbols,
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
  varSymbols: Map<string, BoundVarSymbol>;
  constSymbols: Map<string, BoundConstSymbol>;
  animatorSymbols: ReadonlyMap<string, BoundAnimatorSymbol>;
  tempNamesInScope: Set<string>;
}): { ok: true; boundPattern: BoundMatchPattern } | { ok: false; report: DiagnosticReport } {
  if (params.pattern.kind === "equality_pattern") {
    const bindCompareResult = bindMethodArgumentExpression({
      expression: params.pattern.compareExpression,
      refSymbolTable: params.refSymbolTable,
      varSymbols: params.varSymbols,
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
      varSymbols: params.varSymbols,
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
      varSymbols: params.varSymbols,
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
  varSymbols: Map<string, BoundVarSymbol>;
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
      varSymbols: params.varSymbols,
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
    const varBinding = params.varSymbols.get(name);
    if (varBinding === undefined) {
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
      expression: { kind: "var_reference", varName: name },
    };
  }

  if (params.expression.kind === "state_path_elapsed_expression") {
    return {
      ok: true,
      expression: {
        kind: "state_path_elapsed_reference",
        statePathText: params.expression.statePathText,
        range: params.expression.range,
      },
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
        varSymbols: params.varSymbols,
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

function resolveBoundStateMachineConfiguredLeafPath(
  nodesByPath: Map<string, BoundStateMachineNode>,
  path: string,
): string | undefined {
  const node = nodesByPath.get(path);
  if (node === undefined) {
    return undefined;
  }
  if (node.childSimpleNames.length === 0) {
    return path;
  }
  if (node.initialChildLeafPath === undefined) {
    return undefined;
  }
  return resolveBoundStateMachineConfiguredLeafPath(nodesByPath, node.initialChildLeafPath);
}

function collectBoundStateMachineTransitionValidationDiagnostics(params: {
  machineDeclarationRange: import("../ast/script-ast").AstRange;
  nodesByPath: Map<string, BoundStateMachineNode>;
  machineGlobalTransitions: BoundStateMachineTransition[];
}): DiagnosticReport["diagnostics"] {
  const diagnostics: DiagnosticReport["diagnostics"] = [];

  for (const [, node] of params.nodesByPath) {
    if (node.childSimpleNames.length > 0 && node.initialChildLeafPath === undefined) {
      diagnostics.push(
        buildSemanticCompositeStateRequiresInitialChild({
          path: node.path,
          range: astRangeToSourceRange(params.machineDeclarationRange),
        }),
      );
    }
  }

  const checkTarget = (targetPath: string, range: import("../ast/script-ast").AstRange) => {
    const resolved = resolveBoundStateMachineConfiguredLeafPath(params.nodesByPath, targetPath);
    if (resolved === undefined) {
      diagnostics.push(
        buildSemanticInvalidStateMachineTransitionTarget({
          targetPath,
          range: astRangeToSourceRange(range),
        }),
      );
    }
  };

  for (const transition of params.machineGlobalTransitions) {
    checkTarget(transition.targetPath, transition.range);
  }

  for (const [, node] of params.nodesByPath) {
    for (const localTransition of node.localTransitions) {
      checkTarget(localTransition.targetPath, localTransition.range);
    }
  }

  return diagnostics;
}

function bindStateMachineDeclarationAst(params: {
  declaration: StateMachineDeclarationAst;
  refSymbolTable: RefSymbolTable;
  varSymbols: Map<string, BoundVarSymbol>;
  constSymbols: Map<string, BoundConstSymbol>;
  animatorSymbols: ReadonlyMap<string, BoundAnimatorSymbol>;
}): { ok: true; definition: BoundStateMachineDefinition } | { ok: false; report: DiagnosticReport } {
  const bindCtx = {
    refSymbolTable: params.refSymbolTable,
    varSymbols: params.varSymbols,
    constSymbols: params.constSymbols,
    animatorSymbols: params.animatorSymbols,
    tempNamesInScope: new Set<string>(),
  };

  const nodesByPath = new Map<string, BoundStateMachineNode>();
  const machineGlobalTransitions: BoundStateMachineTransition[] = [];

  for (const item of params.declaration.bodyItems) {
    if (item.kind === "state_machine_global_transition") {
      const condResult = bindMethodArgumentExpression({
        expression: item.conditionExpression,
        ...bindCtx,
      });
      if (condResult.ok === false) {
        return condResult;
      }
      machineGlobalTransitions.push({
        condition: condResult.expression,
        targetPath: item.targetStatePathText,
        range: item.range,
      });
      continue;
    }

    const walkResult = walkStateMachineStateBlock({
      block: item,
      machineName: params.declaration.machineName,
      parentPath: undefined,
      nodesByPath,
      bindCtx,
    });
    if (walkResult.ok === false) {
      return walkResult;
    }
  }

  const initialLeafPath = params.declaration.initialStatePathText;
  if (!nodesByPath.has(initialLeafPath)) {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildNameUnknownReference({
          name: initialLeafPath,
          range: astRangeToSourceRange(params.declaration.initialStatePathRange),
          rangeText: initialLeafPath,
        }),
      ]),
    };
  }

  const resolvedInitialLeafPath = resolveBoundStateMachineConfiguredLeafPath(nodesByPath, initialLeafPath);
  if (resolvedInitialLeafPath === undefined) {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildSemanticUnresolvedInitialLeafPath({
          path: initialLeafPath,
          range: astRangeToSourceRange(params.declaration.initialStatePathRange),
        }),
      ]),
    };
  }

  const transitionDiagnostics = collectBoundStateMachineTransitionValidationDiagnostics({
    machineDeclarationRange: params.declaration.range,
    nodesByPath,
    machineGlobalTransitions,
  });
  if (transitionDiagnostics.length > 0) {
    return { ok: false, report: createDiagnosticReport(transitionDiagnostics) };
  }

  return {
    ok: true,
    definition: {
      machineName: params.declaration.machineName,
      tickIntervalValue: params.declaration.tickIntervalValue,
      tickIntervalUnit: params.declaration.tickIntervalUnit,
      tickIntervalRange: params.declaration.tickIntervalRange,
      initialLeafPath: resolvedInitialLeafPath,
      nodesByPath,
      machineGlobalTransitions,
      range: params.declaration.range,
    },
  };
}

function walkStateMachineStateBlock(params: {
  block: import("../ast/script-ast").StateMachineStateBlockAst;
  machineName: string;
  parentPath: string | undefined;
  nodesByPath: Map<string, BoundStateMachineNode>;
  bindCtx: {
    refSymbolTable: RefSymbolTable;
    varSymbols: Map<string, BoundVarSymbol>;
    constSymbols: Map<string, BoundConstSymbol>;
    animatorSymbols: ReadonlyMap<string, BoundAnimatorSymbol>;
    tempNamesInScope: Set<string>;
  };
}): { ok: true } | { ok: false; report: DiagnosticReport } {
  const fullPath =
    params.parentPath === undefined
      ? `${params.machineName}.${params.block.stateName}`
      : `${params.parentPath}.${params.block.stateName}`;

  if (params.nodesByPath.has(fullPath)) {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildNameDuplicateDeclaration({
          name: fullPath,
          range: astRangeToSourceRange(params.block.range),
          secondaryRange: astRangeToSourceRange(params.block.range),
        }),
      ]),
    };
  }

  const localTransitions: BoundStateMachineTransition[] = [];
  const childSimpleNames: string[] = [];

  for (const item of params.block.items) {
    if (item.kind === "state_machine_local_transition") {
      const condResult = bindMethodArgumentExpression({
        expression: item.conditionExpression,
        refSymbolTable: params.bindCtx.refSymbolTable,
        varSymbols: params.bindCtx.varSymbols,
        constSymbols: params.bindCtx.constSymbols,
        animatorSymbols: params.bindCtx.animatorSymbols,
        tempNamesInScope: params.bindCtx.tempNamesInScope,
      });
      if (condResult.ok === false) {
        return condResult;
      }
      localTransitions.push({
        condition: condResult.expression,
        targetPath: item.targetStatePathText,
        range: item.range,
      });
      continue;
    }

    childSimpleNames.push(item.stateName);
    const nestedResult = walkStateMachineStateBlock({
      block: item,
      machineName: params.machineName,
      parentPath: fullPath,
      nodesByPath: params.nodesByPath,
      bindCtx: params.bindCtx,
    });
    if (nestedResult.ok === false) {
      return nestedResult;
    }
  }

  params.nodesByPath.set(fullPath, {
    path: fullPath,
    simpleName: params.block.stateName,
    childSimpleNames,
    initialChildLeafPath: params.block.initialChildStatePathText,
    localTransitions,
  });

  return { ok: true };
}
