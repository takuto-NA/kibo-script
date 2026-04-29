/**
 * バインド済み AST を SimulationRuntime が実行する CompiledProgram（IR）へ下げる。
 */

import type {
  BoundExpression,
  BoundProgram,
  BoundStatement,
} from "./bound-program";
import type {
  CompiledEveryTask,
  CompiledOnEventTask,
  CompiledProgram,
  ExecutableExpression,
  ExecutableStatement,
} from "../core/executable-task";

export function lowerBoundProgramToCompiledProgram(boundProgram: BoundProgram): CompiledProgram {
  const stateInitializers = boundProgram.stateSymbolsInSourceOrder.map((symbol) => ({
    stateName: symbol.stateName,
    expression: lowerBoundExpression(symbol.initialValue),
  }));

  const animatorDefinitions = boundProgram.animatorSymbolsInSourceOrder.map((symbol) => ({
    animatorName: symbol.animatorName,
    fromPercent: symbol.fromPercent,
    toPercent: symbol.toPercent,
    durationMilliseconds: symbol.durationValue,
    ease: symbol.easeName === "linear" ? ("linear" as const) : ("ease_in_out" as const),
  }));

  const everyTasks: CompiledEveryTask[] = boundProgram.tasks.map((task) => ({
    taskName: task.taskName,
    intervalMilliseconds: task.intervalValue,
    statements: task.statements.map(lowerBoundStatementToExecutableStatement),
  }));

  const onEventTasks: CompiledOnEventTask[] = boundProgram.onEventTasks.map((task) => ({
    taskName: task.taskName,
    deviceAddress: task.deviceAddress,
    eventName: task.eventName,
    statements: task.statements.map(lowerBoundStatementToExecutableStatement),
  }));

  return {
    stateInitializers,
    animatorDefinitions,
    everyTasks,
    onEventTasks,
  };
}

export function lowerBoundStatementToExecutableStatement(statement: BoundStatement): ExecutableStatement {
  if (statement.kind === "do_statement") {
    return {
      kind: "do_method_call",
      deviceAddress: statement.deviceAddress,
      methodName: statement.methodName,
      arguments: statement.arguments.map(lowerBoundExpression),
    };
  }

  if (statement.kind === "set_statement") {
    return {
      kind: "assign_state",
      stateName: statement.stateName,
      valueExpression: lowerBoundExpression(statement.valueExpression),
    };
  }

  if (statement.kind === "match_statement") {
    return {
      kind: "match_string",
      targetExpression: lowerBoundExpression(statement.matchExpression),
      stringCases: statement.stringCases.map((stringCase) => ({
        patternString: stringCase.patternString,
        branchStatements: stringCase.statements.map(lowerBoundStatementToExecutableStatement),
      })),
      elseBranchStatements: statement.elseStatements.map(lowerBoundStatementToExecutableStatement),
    };
  }

  return {
    kind: "wait_milliseconds",
    waitMilliseconds: statement.waitMilliseconds,
  };
}

function lowerBoundExpression(expression: BoundExpression): ExecutableExpression {
  if (expression.kind === "integer") {
    return { kind: "integer_literal", value: expression.value };
  }

  if (expression.kind === "percent") {
    return { kind: "integer_literal", value: expression.value };
  }

  if (expression.kind === "dt_reference") {
    return { kind: "dt_interval_ms" };
  }

  if (expression.kind === "step_animator") {
    return { kind: "step_animator", animatorName: expression.animatorName };
  }

  if (expression.kind === "string") {
    return { kind: "string_literal", value: expression.value };
  }

  if (expression.kind === "identifier") {
    return { kind: "state_reference", stateName: expression.name };
  }

  if (expression.kind === "binary_add") {
    return {
      kind: "binary_add",
      left: lowerBoundExpression(expression.left),
      right: lowerBoundExpression(expression.right),
    };
  }

  return {
    kind: "read_property",
    deviceAddress: expression.deviceAddress,
    propertyName: expression.propertyName,
  };
}
