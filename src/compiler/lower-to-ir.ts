/**
 * バインド済み AST を SimulationRuntime が実行する CompiledProgram（IR）へ下げる。
 */

import type {
  BoundExpression,
  BoundMatchPattern,
  BoundProgram,
  BoundStatement,
} from "./bound-program";
import type {
  CompiledEveryTask,
  CompiledLoopTask,
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

  const animatorDefinitions = boundProgram.animatorSymbolsInSourceOrder.map((symbol) => {
    const ease = symbol.easeName === "linear" ? ("linear" as const) : ("ease_in_out" as const);
    if (symbol.rampKind === "from_to") {
      return {
        animatorName: symbol.animatorName,
        rampKind: "from_to" as const,
        fromPercent: symbol.fromPercent,
        toPercent: symbol.toPercent,
        durationMilliseconds: symbol.durationValue,
        ease,
      };
    }
    return {
      animatorName: symbol.animatorName,
      rampKind: "over_only" as const,
      durationMilliseconds: symbol.durationValue,
      ease,
    };
  });

  const everyTasks: CompiledEveryTask[] = boundProgram.everyTasks.map((task) => ({
    taskName: task.taskName,
    intervalMilliseconds: task.intervalValue,
    statements: task.statements.map(lowerBoundStatementToExecutableStatement),
  }));

  const loopTasks: CompiledLoopTask[] = boundProgram.loopTasks.map((task) => ({
    taskName: task.taskName,
    statements: task.statements.map(lowerBoundStatementToExecutableStatement),
  }));

  const onEventTasks: CompiledOnEventTask[] = boundProgram.onEventTasks.map((task) => ({
    taskName: task.taskName,
    deviceAddress: task.deviceAddress,
    eventName: task.eventName,
    statements: task.statements.map(lowerBoundStatementToExecutableStatement),
  }));

  const constInitializers = boundProgram.constSymbolsInSourceOrder.map((symbol) => ({
    constName: symbol.constName,
    expression: lowerBoundExpression(symbol.initialValue),
  }));

  return {
    stateInitializers,
    constInitializers,
    animatorDefinitions,
    everyTasks,
    loopTasks,
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

  if (statement.kind === "temp_statement") {
    return {
      kind: "assign_temp",
      tempName: statement.tempName,
      valueExpression: lowerBoundExpression(statement.valueExpression),
    };
  }

  if (statement.kind === "wait_statement") {
    return {
      kind: "wait_milliseconds",
      durationMillisecondsExpression: lowerBoundExpression(statement.durationMillisecondsExpression),
    };
  }

  if (statement.kind === "if_statement") {
    return {
      kind: "if_comparison",
      conditionExpression: lowerBoundExpression(statement.conditionExpression),
      thenBranchStatements: statement.thenStatements.map(lowerBoundStatementToExecutableStatement),
      elseBranchStatements: statement.elseStatements.map(lowerBoundStatementToExecutableStatement),
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

  const exhaustiveStatement: never = statement;
  throw new Error(`Unhandled statement kind: ${JSON.stringify(exhaustiveStatement)}`);
}

function lowerBoundMatchPattern(pattern: BoundMatchPattern): import("../core/executable-task").ExecutableMatchPattern {
  if (pattern.kind === "equality_pattern") {
    return {
      kind: "equality_pattern",
      compareExpression: lowerBoundExpression(pattern.compareExpression),
    };
  }

  return {
    kind: "range_pattern",
    startInclusive:
      pattern.startInclusive !== undefined ? lowerBoundExpression(pattern.startInclusive) : undefined,
    endExclusive:
      pattern.endExclusive !== undefined ? lowerBoundExpression(pattern.endExclusive) : undefined,
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
    return {
      kind: "step_animator",
      animatorName: expression.animatorName,
      targetExpression:
        expression.targetExpression !== undefined ? lowerBoundExpression(expression.targetExpression) : undefined,
    };
  }

  if (expression.kind === "string") {
    return { kind: "string_literal", value: expression.value };
  }

  if (expression.kind === "identifier") {
    return { kind: "state_reference", stateName: expression.name };
  }

  if (expression.kind === "const_reference") {
    return { kind: "const_reference", constName: expression.constName };
  }

  if (expression.kind === "temp_reference") {
    return { kind: "temp_reference", tempName: expression.tempName };
  }

  if (expression.kind === "binary_add") {
    return {
      kind: "binary_add",
      left: lowerBoundExpression(expression.left),
      right: lowerBoundExpression(expression.right),
    };
  }

  if (expression.kind === "binary_sub") {
    return {
      kind: "binary_sub",
      left: lowerBoundExpression(expression.left),
      right: lowerBoundExpression(expression.right),
    };
  }

  if (expression.kind === "binary_mul") {
    return {
      kind: "binary_mul",
      left: lowerBoundExpression(expression.left),
      right: lowerBoundExpression(expression.right),
    };
  }

  if (expression.kind === "binary_div") {
    return {
      kind: "binary_div",
      left: lowerBoundExpression(expression.left),
      right: lowerBoundExpression(expression.right),
    };
  }

  if (expression.kind === "unary_minus") {
    return {
      kind: "unary_minus",
      operand: lowerBoundExpression(expression.operand),
    };
  }

  if (expression.kind === "comparison") {
    return {
      kind: "comparison",
      operator: expression.operator,
      left: lowerBoundExpression(expression.left),
      right: lowerBoundExpression(expression.right),
    };
  }

  if (expression.kind === "match_expression") {
    return {
      kind: "match_numeric_expression",
      scrutinee: lowerBoundExpression(expression.scrutinee),
      arms: expression.arms.map((arm) => ({
        pattern: lowerBoundMatchPattern(arm.pattern),
        resultExpression: lowerBoundExpression(arm.resultExpression),
      })),
      elseResultExpression:
        expression.elseResultExpression !== undefined
          ? lowerBoundExpression(expression.elseResultExpression)
          : undefined,
    };
  }

  if (expression.kind === "read_property") {
    return {
      kind: "read_property",
      deviceAddress: expression.deviceAddress,
      propertyName: expression.propertyName,
    };
  }

  const exhaustiveExpression: never = expression;
  throw new Error(`Unhandled expression kind: ${JSON.stringify(exhaustiveExpression)}`);
}
