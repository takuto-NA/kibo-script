/**
 * 責務: runtime world の drop 可否判定のため、compiled task 本体から参照される
 * デバイス・var・状態パスを収集する（早期リターン・浅い再帰）。
 */

import type { DeviceAddress } from "./device-address";
import { formatDeviceAddress } from "./device-address";
import type {
  ExecutableExpression,
  ExecutableMatchPattern,
  ExecutableStatement,
} from "./executable-task";

export function collectDeviceAddressKeysFromStatements(statements: ExecutableStatement[]): Set<string> {
  const keys = new Set<string>();
  for (const statement of statements) {
    collectDeviceKeysFromStatement(statement, keys);
  }
  return keys;
}

export function collectVarNamesReferencedFromStatements(statements: ExecutableStatement[]): Set<string> {
  const names = new Set<string>();
  for (const statement of statements) {
    collectVarNamesFromStatement(statement, names);
  }
  return names;
}

export function collectStatePathTextsFromStatements(statements: ExecutableStatement[]): Set<string> {
  const paths = new Set<string>();
  for (const statement of statements) {
    collectStatePathsFromStatement(statement, paths);
  }
  return paths;
}

function collectDeviceKeysFromStatement(statement: ExecutableStatement, keys: Set<string>): void {
  if (statement.kind === "do_method_call") {
    keys.add(formatDeviceAddress(statement.deviceAddress));
    for (const argument of statement.arguments) {
      collectDeviceKeysFromExpression(argument, keys);
    }
    return;
  }

  if (statement.kind === "assign_var") {
    collectDeviceKeysFromExpression(statement.valueExpression, keys);
    return;
  }

  if (statement.kind === "assign_temp") {
    collectDeviceKeysFromExpression(statement.valueExpression, keys);
    return;
  }

  if (statement.kind === "wait_milliseconds") {
    collectDeviceKeysFromExpression(statement.durationMillisecondsExpression, keys);
    return;
  }

  if (statement.kind === "match_string") {
    collectDeviceKeysFromExpression(statement.targetExpression, keys);
    for (const stringCase of statement.stringCases) {
      collectDeviceKeysFromStatements(stringCase.branchStatements, keys);
    }
    collectDeviceKeysFromStatements(statement.elseBranchStatements, keys);
    return;
  }

  if (statement.kind === "if_comparison") {
    collectDeviceKeysFromExpression(statement.conditionExpression, keys);
    collectDeviceKeysFromStatements(statement.thenBranchStatements, keys);
    collectDeviceKeysFromStatements(statement.elseBranchStatements, keys);
  }
}

function collectDeviceKeysFromStatements(statements: ExecutableStatement[], keys: Set<string>): void {
  for (const statement of statements) {
    collectDeviceKeysFromStatement(statement, keys);
  }
}

function collectDeviceKeysFromExpression(expression: ExecutableExpression, keys: Set<string>): void {
  if (expression.kind === "read_property") {
    keys.add(formatDeviceAddress(expression.deviceAddress));
    return;
  }

  if (
    expression.kind === "binary_add" ||
    expression.kind === "binary_sub" ||
    expression.kind === "binary_mul" ||
    expression.kind === "binary_div"
  ) {
    collectDeviceKeysFromExpression(expression.left, keys);
    collectDeviceKeysFromExpression(expression.right, keys);
    return;
  }

  if (expression.kind === "unary_minus") {
    collectDeviceKeysFromExpression(expression.operand, keys);
    return;
  }

  if (expression.kind === "comparison") {
    collectDeviceKeysFromExpression(expression.left, keys);
    collectDeviceKeysFromExpression(expression.right, keys);
    return;
  }

  if (expression.kind === "match_numeric_expression") {
    collectDeviceKeysFromExpression(expression.scrutinee, keys);
    for (const arm of expression.arms) {
      collectDeviceKeysFromMatchPattern(arm.pattern, keys);
      collectDeviceKeysFromExpression(arm.resultExpression, keys);
    }
    if (expression.elseResultExpression !== undefined) {
      collectDeviceKeysFromExpression(expression.elseResultExpression, keys);
    }
    return;
  }

  if (expression.kind === "step_animator") {
    if (expression.targetExpression !== undefined) {
      collectDeviceKeysFromExpression(expression.targetExpression, keys);
    }
    return;
  }

  if (
    expression.kind === "integer_literal" ||
    expression.kind === "string_literal" ||
    expression.kind === "var_reference" ||
    expression.kind === "const_reference" ||
    expression.kind === "temp_reference" ||
    expression.kind === "dt_interval_ms" ||
    expression.kind === "state_path_elapsed_reference"
  ) {
    return;
  }
}

function collectDeviceKeysFromMatchPattern(pattern: ExecutableMatchPattern, keys: Set<string>): void {
  if (pattern.kind === "equality_pattern") {
    collectDeviceKeysFromExpression(pattern.compareExpression, keys);
    return;
  }
  if (pattern.startInclusive !== undefined) {
    collectDeviceKeysFromExpression(pattern.startInclusive, keys);
  }
  if (pattern.endExclusive !== undefined) {
    collectDeviceKeysFromExpression(pattern.endExclusive, keys);
  }
}

function collectVarNamesFromStatement(statement: ExecutableStatement, names: Set<string>): void {
  if (statement.kind === "do_method_call") {
    for (const argument of statement.arguments) {
      collectVarNamesFromExpression(argument, names);
    }
    return;
  }

  if (statement.kind === "assign_var") {
    names.add(statement.varName);
    collectVarNamesFromExpression(statement.valueExpression, names);
    return;
  }

  if (statement.kind === "assign_temp") {
    collectVarNamesFromExpression(statement.valueExpression, names);
    return;
  }

  if (statement.kind === "wait_milliseconds") {
    collectVarNamesFromExpression(statement.durationMillisecondsExpression, names);
    return;
  }

  if (statement.kind === "match_string") {
    collectVarNamesFromExpression(statement.targetExpression, names);
    for (const stringCase of statement.stringCases) {
      for (const branchStatement of stringCase.branchStatements) {
        collectVarNamesFromStatement(branchStatement, names);
      }
    }
    for (const elseStatement of statement.elseBranchStatements) {
      collectVarNamesFromStatement(elseStatement, names);
    }
    return;
  }

  if (statement.kind === "if_comparison") {
    collectVarNamesFromExpression(statement.conditionExpression, names);
    for (const s of statement.thenBranchStatements) {
      collectVarNamesFromStatement(s, names);
    }
    for (const s of statement.elseBranchStatements) {
      collectVarNamesFromStatement(s, names);
    }
  }
}

function collectVarNamesFromExpression(expression: ExecutableExpression, names: Set<string>): void {
  if (expression.kind === "var_reference") {
    names.add(expression.varName);
    return;
  }

  if (expression.kind === "binary_add" || expression.kind === "binary_sub" || expression.kind === "binary_mul" || expression.kind === "binary_div") {
    collectVarNamesFromExpression(expression.left, names);
    collectVarNamesFromExpression(expression.right, names);
    return;
  }

  if (expression.kind === "unary_minus") {
    collectVarNamesFromExpression(expression.operand, names);
    return;
  }

  if (expression.kind === "comparison") {
    collectVarNamesFromExpression(expression.left, names);
    collectVarNamesFromExpression(expression.right, names);
    return;
  }

  if (expression.kind === "match_numeric_expression") {
    collectVarNamesFromExpression(expression.scrutinee, names);
    for (const arm of expression.arms) {
      collectVarNamesFromMatchPattern(arm.pattern, names);
      collectVarNamesFromExpression(arm.resultExpression, names);
    }
    if (expression.elseResultExpression !== undefined) {
      collectVarNamesFromExpression(expression.elseResultExpression, names);
    }
    return;
  }

  if (expression.kind === "read_property") {
    return;
  }

  if (
    expression.kind === "integer_literal" ||
    expression.kind === "string_literal" ||
    expression.kind === "const_reference" ||
    expression.kind === "temp_reference" ||
    expression.kind === "dt_interval_ms" ||
    expression.kind === "state_path_elapsed_reference"
  ) {
    return;
  }

  if (expression.kind === "step_animator" && expression.targetExpression !== undefined) {
    collectVarNamesFromExpression(expression.targetExpression, names);
  }
}

function collectVarNamesFromMatchPattern(pattern: ExecutableMatchPattern, names: Set<string>): void {
  if (pattern.kind === "equality_pattern") {
    collectVarNamesFromExpression(pattern.compareExpression, names);
    return;
  }
  if (pattern.startInclusive !== undefined) {
    collectVarNamesFromExpression(pattern.startInclusive, names);
  }
  if (pattern.endExclusive !== undefined) {
    collectVarNamesFromExpression(pattern.endExclusive, names);
  }
}

function collectStatePathsFromStatement(statement: ExecutableStatement, paths: Set<string>): void {
  if (statement.kind === "do_method_call") {
    for (const argument of statement.arguments) {
      collectStatePathsFromExpression(argument, paths);
    }
    return;
  }

  if (statement.kind === "assign_var") {
    collectStatePathsFromExpression(statement.valueExpression, paths);
    return;
  }

  if (statement.kind === "assign_temp") {
    collectStatePathsFromExpression(statement.valueExpression, paths);
    return;
  }

  if (statement.kind === "wait_milliseconds") {
    collectStatePathsFromExpression(statement.durationMillisecondsExpression, paths);
    return;
  }

  if (statement.kind === "match_string") {
    collectStatePathsFromExpression(statement.targetExpression, paths);
    for (const stringCase of statement.stringCases) {
      for (const branchStatement of stringCase.branchStatements) {
        collectStatePathsFromStatement(branchStatement, paths);
      }
    }
    for (const elseStatement of statement.elseBranchStatements) {
      collectStatePathsFromStatement(elseStatement, paths);
    }
    return;
  }

  if (statement.kind === "if_comparison") {
    collectStatePathsFromExpression(statement.conditionExpression, paths);
    for (const s of statement.thenBranchStatements) {
      collectStatePathsFromStatement(s, paths);
    }
    for (const s of statement.elseBranchStatements) {
      collectStatePathsFromStatement(s, paths);
    }
  }
}

function collectStatePathsFromExpression(expression: ExecutableExpression, paths: Set<string>): void {
  if (expression.kind === "state_path_elapsed_reference") {
    paths.add(expression.statePathText);
    return;
  }

  if (expression.kind === "binary_add" || expression.kind === "binary_sub" || expression.kind === "binary_mul" || expression.kind === "binary_div") {
    collectStatePathsFromExpression(expression.left, paths);
    collectStatePathsFromExpression(expression.right, paths);
    return;
  }

  if (expression.kind === "unary_minus") {
    collectStatePathsFromExpression(expression.operand, paths);
    return;
  }

  if (expression.kind === "comparison") {
    collectStatePathsFromExpression(expression.left, paths);
    collectStatePathsFromExpression(expression.right, paths);
    return;
  }

  if (expression.kind === "match_numeric_expression") {
    collectStatePathsFromExpression(expression.scrutinee, paths);
    for (const arm of expression.arms) {
      collectStatePathsFromMatchPattern(arm.pattern, paths);
      collectStatePathsFromExpression(arm.resultExpression, paths);
    }
    if (expression.elseResultExpression !== undefined) {
      collectStatePathsFromExpression(expression.elseResultExpression, paths);
    }
    return;
  }

  if (expression.kind === "step_animator" && expression.targetExpression !== undefined) {
    collectStatePathsFromExpression(expression.targetExpression, paths);
  }
}

function collectStatePathsFromMatchPattern(pattern: ExecutableMatchPattern, paths: Set<string>): void {
  if (pattern.kind === "equality_pattern") {
    collectStatePathsFromExpression(pattern.compareExpression, paths);
    return;
  }
  if (pattern.startInclusive !== undefined) {
    collectStatePathsFromExpression(pattern.startInclusive, paths);
  }
  if (pattern.endExclusive !== undefined) {
    collectStatePathsFromExpression(pattern.endExclusive, paths);
  }
}

/** deviceAddress がキー集合に含まれるか（drop ref 用）。 */
export function isDeviceAddressInKeySet(address: DeviceAddress, keys: Set<string>): boolean {
  return keys.has(formatDeviceAddress(address));
}
