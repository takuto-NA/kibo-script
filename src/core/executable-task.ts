import type { DeviceAddress } from "./device-address";

/**
 * Runtime IR: statements executable by SimulationRuntime for compiled tasks.
 */
export type ExecutableExpression =
  | { kind: "integer_literal"; value: number }
  | { kind: "string_literal"; value: string }
  | { kind: "state_reference"; stateName: string }
  /** `task every` の 1 回起動の名目 dt（ms）。on_event では式として使えない。 */
  | { kind: "dt_interval_ms" }
  /** アニメータを dt 分進め、現在のパーセント（整数）を返す。`over_only` 定義では target が必須。 */
  | { kind: "step_animator"; animatorName: string; targetExpression?: ExecutableExpression }
  | { kind: "binary_add"; left: ExecutableExpression; right: ExecutableExpression }
  | {
      kind: "read_property";
      deviceAddress: DeviceAddress;
      propertyName: string;
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
      kind: "wait_milliseconds";
      waitMilliseconds: number;
    }
  | {
      kind: "match_string";
      targetExpression: ExecutableExpression;
      stringCases: { patternString: string; branchStatements: ExecutableStatement[] }[];
      elseBranchStatements: ExecutableStatement[];
    };

export type CompiledEveryTask = {
  taskName: string;
  intervalMilliseconds: number;
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
  animatorDefinitions: CompiledAnimatorDefinition[];
  everyTasks: CompiledEveryTask[];
  onEventTasks: CompiledOnEventTask[];
};
