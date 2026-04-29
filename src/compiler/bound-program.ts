import type { AstRange } from "../ast/script-ast";
import type { DeviceAddress } from "../core/device-address";

export type BoundProgram = {
  sourceFileName: string;
  refSymbols: Map<string, BoundRefSymbol>;
  /** Compiler-visible script state names -> initialized binding */
  stateSymbols: Map<string, BoundStateSymbol>;
  /** `const` 宣言: 不変。state と同名不可。 */
  constSymbols: Map<string, BoundConstSymbol>;
  /** `const` 宣言がソースに現れた順。 */
  constSymbolsInSourceOrder: BoundConstSymbol[];
  /** `state` 宣言がソースに現れた順（初期化評価順）。 */
  stateSymbolsInSourceOrder: BoundStateSymbol[];
  /**
   * アニメータ名 -> 定義。宣言の重複は束縛前に弾く。
   */
  animatorSymbols: Map<string, BoundAnimatorSymbol>;
  /** IR 下げ用に宣言順を保持 */
  animatorSymbolsInSourceOrder: BoundAnimatorSymbol[];
  tasks: BoundTask[];
  onEventTasks: BoundOnEventTask[];
  /** state / const をソース順に束縛した行（型推論の宣言順序に使用） */
  valueSymbolsInSourceOrder: BoundValueSymbolInSourceOrderRow[];
};

export type BoundValueSymbolInSourceOrderRow =
  | {
      kind: "state";
      name: string;
      initialValue: BoundExpression;
      range: AstRange;
    }
  | {
      kind: "const";
      name: string;
      initialValue: BoundExpression;
      range: AstRange;
    };

export type BoundRefSymbol = {
  symbolName: string;
  deviceAddress: DeviceAddress;
  range: AstRange;
};

export type BoundStateSymbol = {
  stateName: string;
  initialValue: BoundExpression;
  range: AstRange;
};

export type BoundConstSymbol = {
  constName: string;
  initialValue: BoundExpression;
  range: AstRange;
};

/**
 * 束縛済み animator 定義（型検査通過後に ease は linear / ease_in_out のみ）
 */
export type BoundAnimatorSymbol = {
  animatorName: string;
  /** `ramp from ... to ...` か `ramp over ...`（目標は step の引数） */
  rampKind: "from_to" | "over_only";
  fromPercent: number;
  toPercent: number;
  fromPercentRange: AstRange;
  toPercentRange: AstRange;
  durationValue: number;
  durationUnit: "ms" | "deg";
  durationRange: AstRange;
  easeName: string;
  easeRange: AstRange;
  range: AstRange;
};

export type BoundTask = {
  taskName: string;
  intervalValue: number;
  intervalUnit: "ms" | "deg";
  intervalRange: AstRange;
  statements: BoundStatement[];
  range: AstRange;
};

export type BoundOnEventTask = {
  taskName: string;
  deviceAddress: DeviceAddress;
  eventName: string;
  statements: BoundStatement[];
  range: AstRange;
};

export type BoundStatement =
  | BoundDoStatement
  | BoundSetStatement
  | BoundWaitStatement
  | BoundMatchStatement
  | BoundTempStatement
  | BoundIfStatement;

export type BoundTempStatement = {
  kind: "temp_statement";
  range: AstRange;
  tempName: string;
  valueExpression: BoundExpression;
};

export type BoundIfStatement = {
  kind: "if_statement";
  range: AstRange;
  conditionExpression: BoundExpression;
  thenStatements: BoundStatement[];
  elseStatements: BoundStatement[];
};

export type BoundMatchStatement = {
  kind: "match_statement";
  range: AstRange;
  matchExpression: BoundExpression;
  stringCases: { patternString: string; statements: BoundStatement[] }[];
  elseStatements: BoundStatement[];
};

export type BoundDoStatement = {
  kind: "do_statement";
  deviceAddress: DeviceAddress;
  methodName: string;
  arguments: BoundExpression[];
  range: AstRange;
};

export type BoundSetStatement = {
  kind: "set_statement";
  stateName: string;
  valueExpression: BoundExpression;
  range: AstRange;
};

export type BoundWaitStatement = {
  kind: "wait_statement";
  waitMilliseconds: number;
  waitRange: AstRange;
  range: AstRange;
};

export type BoundExpression =
  | { kind: "integer"; value: number }
  | { kind: "string"; value: string }
  | { kind: "identifier"; name: string }
  | { kind: "const_reference"; constName: string }
  | { kind: "temp_reference"; tempName: string }
  | { kind: "percent"; value: number; range: AstRange }
  | { kind: "dt_reference"; range: AstRange }
  | { kind: "step_animator"; animatorName: string; targetExpression?: BoundExpression; range: AstRange }
  | { kind: "binary_add"; left: BoundExpression; right: BoundExpression }
  | { kind: "binary_sub"; left: BoundExpression; right: BoundExpression }
  | { kind: "binary_mul"; left: BoundExpression; right: BoundExpression }
  | { kind: "binary_div"; left: BoundExpression; right: BoundExpression }
  | { kind: "unary_minus"; operand: BoundExpression }
  | {
      kind: "comparison";
      operator: "==" | "!=" | "<" | "<=" | ">" | ">=";
      left: BoundExpression;
      right: BoundExpression;
    }
  | {
      kind: "match_expression";
      range: AstRange;
      scrutinee: BoundExpression;
      arms: { pattern: BoundMatchPattern; resultExpression: BoundExpression; range: AstRange }[];
      elseResultExpression?: BoundExpression;
    }
  | {
      kind: "read_property";
      deviceAddress: DeviceAddress;
      propertyName: string;
      range: AstRange;
    };

export type BoundMatchPattern =
  | { kind: "equality_pattern"; compareExpression: BoundExpression; range: AstRange }
  | {
      kind: "range_pattern";
      range: AstRange;
      startInclusive?: BoundExpression;
      endExclusive?: BoundExpression;
    };
