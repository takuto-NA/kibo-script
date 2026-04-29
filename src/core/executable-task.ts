import type { DeviceAddress } from "./device-address";

/**
 * Runtime IR: statements executable by SimulationRuntime for compiled tasks.
 */
export type ExecutableExpression =
  | { kind: "integer_literal"; value: number }
  | { kind: "string_literal"; value: string }
  | { kind: "state_reference"; stateName: string }
  | { kind: "const_reference"; constName: string }
  | { kind: "temp_reference"; tempName: string }
  /** `task every` の 1 回起動の名目 dt（ms）。on_event では式として使えない。 */
  | { kind: "dt_interval_ms" }
  /** アニメータを dt 分進め、現在のパーセント（整数）を返す。`over_only` 定義では target が必須。 */
  | { kind: "step_animator"; animatorName: string; targetExpression?: ExecutableExpression }
  | { kind: "binary_add"; left: ExecutableExpression; right: ExecutableExpression }
  | { kind: "binary_sub"; left: ExecutableExpression; right: ExecutableExpression }
  | { kind: "binary_mul"; left: ExecutableExpression; right: ExecutableExpression }
  | { kind: "binary_div"; left: ExecutableExpression; right: ExecutableExpression }
  | { kind: "unary_minus"; operand: ExecutableExpression }
  | {
      kind: "comparison";
      operator: "==" | "!=" | "<" | "<=" | ">" | ">=";
      left: ExecutableExpression;
      right: ExecutableExpression;
    }
  | {
      kind: "match_numeric_expression";
      scrutinee: ExecutableExpression;
      arms: { pattern: ExecutableMatchPattern; resultExpression: ExecutableExpression }[];
      elseResultExpression?: ExecutableExpression;
    }
  | {
      kind: "read_property";
      deviceAddress: DeviceAddress;
      propertyName: string;
    };

export type ExecutableMatchPattern =
  | { kind: "equality_pattern"; compareExpression: ExecutableExpression }
  | {
      kind: "range_pattern";
      startInclusive?: ExecutableExpression;
      endExclusive?: ExecutableExpression;
    };

export type ExecutableStatement =
  | {
      kind: "do_method_call";
      deviceAddress: DeviceAddress;
      methodName: string;
      arguments: ExecutableExpression[];
    }
  | {
      kind: "assign_state";
      stateName: string;
      valueExpression: ExecutableExpression;
    }
  | {
      kind: "assign_temp";
      tempName: string;
      valueExpression: ExecutableExpression;
    }
  | {
      kind: "wait_milliseconds";
      /** 実行時に 1 回評価し、整数 ms として解釈する（0 以下は実行時にタスク停止）。 */
      durationMillisecondsExpression: ExecutableExpression;
    }
  | {
      kind: "match_string";
      targetExpression: ExecutableExpression;
      stringCases: { patternString: string; branchStatements: ExecutableStatement[] }[];
      elseBranchStatements: ExecutableStatement[];
    }
  | {
      kind: "if_comparison";
      conditionExpression: ExecutableExpression;
      thenBranchStatements: ExecutableStatement[];
      elseBranchStatements: ExecutableStatement[];
    };

export type CompiledEveryTask = {
  taskName: string;
  intervalMilliseconds: number;
  statements: ExecutableStatement[];
};

export type CompiledLoopTask = {
  taskName: string;
  statements: ExecutableStatement[];
};

export type CompiledOnEventTask = {
  taskName: string;
  deviceAddress: DeviceAddress;
  eventName: string;
  statements: ExecutableStatement[];
};

/**
 * シミュレーション用 ramp 定義（責務: 束縛・下げた animator の不変部分）
 */
export type CompiledAnimatorDefinition =
  | {
      animatorName: string;
      rampKind: "from_to";
      fromPercent: number;
      toPercent: number;
      durationMilliseconds: number;
      ease: "linear" | "ease_in_out";
    }
  | {
      animatorName: string;
      rampKind: "over_only";
      durationMilliseconds: number;
      ease: "linear" | "ease_in_out";
    };

export type CompiledProgram = {
  stateInitializers: { stateName: string; expression: ExecutableExpression }[];
  constInitializers: { constName: string; expression: ExecutableExpression }[];
  animatorDefinitions: CompiledAnimatorDefinition[];
  everyTasks: CompiledEveryTask[];
  loopTasks: CompiledLoopTask[];
  onEventTasks: CompiledOnEventTask[];
};
