import type { AstRange } from "../ast/script-ast";
import type { DeviceAddress } from "../core/device-address";

export type BoundProgram = {
  sourceFileName: string;
  refSymbols: Map<string, BoundRefSymbol>;
  /** `ref` 宣言がソースに存在する名前（IR の deviceAliases はここに含まれる ref のみ下げる）。 */
  sourceDeclaredRefNames: ReadonlySet<string>;
  /** Compiler-visible script var names -> initialized binding */
  varSymbols: Map<string, BoundVarSymbol>;
  /** `const` 宣言: 不変。var と同名不可。 */
  constSymbols: Map<string, BoundConstSymbol>;
  /** `const` 宣言がソースに現れた順。 */
  constSymbolsInSourceOrder: BoundConstSymbol[];
  /** `var` 宣言がソースに現れた順（初期化評価順）。 */
  varSymbolsInSourceOrder: BoundVarSymbol[];
  /**
   * アニメータ名 -> 定義。宣言の重複は束縛前に弾く。
   */
  animatorSymbols: Map<string, BoundAnimatorSymbol>;
  /** IR 下げ用に宣言順を保持 */
  animatorSymbolsInSourceOrder: BoundAnimatorSymbol[];
  everyTasks: BoundEveryTask[];
  loopTasks: BoundLoopTask[];
  onEventTasks: BoundOnEventTask[];
  /** var / const をソース順に束縛した行（型推論の宣言順序に使用） */
  valueSymbolsInSourceOrder: BoundValueSymbolInSourceOrderRow[];
  /** v0.5 階層状態機械（名前解決・検証済み） */
  stateMachinesInSourceOrder: BoundStateMachineDefinition[];
};

export type BoundValueSymbolInSourceOrderRow =
  | {
      kind: "var";
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

export type BoundVarSymbol = {
  varName: string;
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

/** `task ... in path ...` の所属（binder で検証済み） */
export type BoundTaskStateMembership =
  | { kind: "none" }
  | { kind: "in_state_path"; statePathText: string; range: AstRange };

export type BoundEveryTask = {
  runKind: "every";
  taskName: string;
  stateMembership: BoundTaskStateMembership;
  intervalValue: number;
  intervalUnit: "ms" | "deg";
  intervalRange: AstRange;
  statements: BoundStatement[];
  range: AstRange;
};

export type BoundLoopTask = {
  runKind: "loop";
  taskName: string;
  stateMembership: BoundTaskStateMembership;
  statements: BoundStatement[];
  range: AstRange;
};

export type BoundTask = BoundEveryTask | BoundLoopTask;

export type BoundOnEventTrigger =
  | { kind: "device_event"; deviceAddress: DeviceAddress; eventName: string }
  | { kind: "state_lifecycle"; lifecycle: "enter" | "exit" };

export type BoundOnEventTask = {
  taskName: string;
  stateMembership: BoundTaskStateMembership;
  trigger: BoundOnEventTrigger;
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
  varName: string;
  valueExpression: BoundExpression;
  range: AstRange;
};

export type BoundWaitStatement = {
  kind: "wait_statement";
  durationMillisecondsExpression: BoundExpression;
  waitRange: AstRange;
  range: AstRange;
};

export type BoundExpression =
  | { kind: "integer"; value: number }
  | { kind: "string"; value: string }
  | { kind: "var_reference"; varName: string }
  | { kind: "const_reference"; constName: string }
  | { kind: "temp_reference"; tempName: string }
  /** `some.Path.elapsed` — 状態経過時間（ms） */
  | { kind: "state_path_elapsed_reference"; statePathText: string; range: AstRange }
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

/** 状態機械 1 台分（binder がフラットなノード表へ展開） */
export type BoundStateMachineDefinition = {
  machineName: string;
  tickIntervalValue: number;
  tickIntervalUnit: "ms" | "deg";
  tickIntervalRange: AstRange;
  initialLeafPath: string;
  /** machine root と各状態ノード（パスキーは絶対パス rover.Child） */
  nodesByPath: Map<string, BoundStateMachineNode>;
  /** 状態機械直下の global transition（draft §8.6 の順で評価されるブロック） */
  machineGlobalTransitions: BoundStateMachineTransition[];
  range: AstRange;
};

export type BoundStateMachineNode = {
  /** 絶対パス（例 rover.Manual.Forward） */
  path: string;
  /** 単純名（例 Forward） */
  simpleName: string;
  /** 直下の子状態の単純名 */
  childSimpleNames: string[];
  /** initial rover.Manual.Stop のような初期子 leaf の絶対パス（無ければ undefined） */
  initialChildLeafPath: string | undefined;
  /** このノードにぶら下がる local/on と直下 global は別構造 — local はノードに保存 */
  localTransitions: BoundStateMachineTransition[];
};

export type BoundStateMachineTransition = {
  condition: BoundExpression;
  targetPath: string;
  range: AstRange;
};
