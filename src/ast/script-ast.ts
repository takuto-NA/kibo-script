import type { SourcePosition } from "../compiler/source-text";

export type AstRange = {
  fileName: string;
  start: SourcePosition;
  end: SourcePosition;
};

export type ProgramAst = {
  kind: "program";
  range: AstRange;
  declarations: TopLevelDeclarationAst[];
};

export type TopLevelDeclarationAst =
  | RefDeclarationAst
  | TaskDeclarationAst
  | StateDeclarationAst
  | TaskOnDeclarationAst
  | AnimatorDeclarationAst;

export type StateDeclarationAst = {
  kind: "state_declaration";
  range: AstRange;
  stateName: string;
  /**
   * Initial value; Phase 1.1+ uses integer expression (literal or larger expression).
   */
  initialValueExpression: MethodArgumentExpressionAst;
};

export type RefDeclarationAst = {
  kind: "ref_declaration";
  range: AstRange;
  symbolName: string;
  deviceKind: string;
  deviceId: number;
};

export type TaskDeclarationAst = {
  kind: "task_declaration";
  range: AstRange;
  taskName: string;
  /** Raw integer before unit token. */
  intervalValue: number;
  /** `ms` for time schedule, or invalid unit for diagnostic tests. */
  intervalUnit: "ms" | "deg";
  intervalRange: AstRange;
  bodyStatements: StatementAst[];
};

export type TaskOnDeclarationAst = {
  kind: "task_on_declaration";
  range: AstRange;
  taskName: string;
  /** 例: button#0.pressed または button.pressed のイベント元。 */
  eventTarget: TaskOnEventTargetAst;
  eventName: string;
  bodyStatements: StatementAst[];
};

/**
 * v1: `animator name = ramp from A% to B% over Nms ease linear|ease_in_out`
 * （不正な単位・ease はパースは通し、型検査で拒否する場合がある）
 */
export type AnimatorDeclarationAst = {
  kind: "animator_declaration";
  range: AstRange;
  animatorName: string;
  fromPercent: number;
  toPercent: number;
  fromPercentRange: AstRange;
  toPercentRange: AstRange;
  durationValue: number;
  durationUnit: "ms" | "deg";
  durationRange: AstRange;
  easeName: string;
  easeRange: AstRange;
};

export type TaskOnEventTargetAst =
  | { kind: "device_event_target"; range: AstRange; deviceKind: string; deviceId: number }
  | { kind: "ref_event_target"; range: AstRange; name: string };

export type StatementAst =
  | DoStatementAst
  | SetStatementAst
  | WaitStatementAst
  | MatchStatementAst;

export type MatchStatementAst = {
  kind: "match_statement";
  range: AstRange;
  matchTargetExpression: MethodArgumentExpressionAst;
  /** `"pattern" => { ... }` の列（0 件可）。 */
  stringCases: MatchStringCaseAst[];
  /** 必須の `else => { ... }`。 */
  elseBodyStatements: StatementAst[];
};

export type MatchStringCaseAst = {
  patternStringLiteral: string;
  bodyStatements: StatementAst[];
};

export type DoStatementAst = {
  kind: "do_statement";
  range: AstRange;
  callExpression: CallExpressionAst;
};

export type SetStatementAst = {
  kind: "set_statement";
  range: AstRange;
  stateName: string;
  valueExpression: MethodArgumentExpressionAst;
};

export type WaitStatementAst = {
  kind: "wait_statement";
  range: AstRange;
  /** Milliseconds before the `ms` unit token. */
  waitMilliseconds: number;
  waitRange: AstRange;
};

/**
 * Call の受信側: `led`（ref）または `led#0`（直接アドレス）。
 */
export type CallReceiverAst =
  | { kind: "ref_receiver"; range: AstRange; name: string }
  | { kind: "device_receiver"; range: AstRange; deviceKind: string; deviceId: number };

export type CallExpressionAst = {
  kind: "call_expression";
  range: AstRange;
  receiver: CallReceiverAst;
  methodName: string;
  arguments: MethodArgumentExpressionAst[];
};

/**
 * メソッド引数と `set` 右辺、`state` 初期化に使う式（足し算 read 等を含む）。
 */
export type MethodArgumentExpressionAst =
  | { kind: "integer_literal"; range: AstRange; value: number }
  | { kind: "percent_literal"; range: AstRange; value: number }
  | { kind: "string_literal"; range: AstRange; value: string }
  | { kind: "identifier_expression"; range: AstRange; name: string }
  /** every タスクの名目間隔（ms）。state 名 `dt` とは別（式では `dt` は常にこれを指す）。 */
  | { kind: "dt_expression"; range: AstRange }
  /** `step <animator> with dt` */
  | {
      kind: "step_animator_expression";
      range: AstRange;
      animatorName: string;
    }
  | { kind: "binary_add"; range: AstRange; left: MethodArgumentExpressionAst; right: MethodArgumentExpressionAst }
  | { kind: "read_expression"; range: AstRange; readTarget: ReadTargetAst };

export type ReadTargetAst =
  | { kind: "device_read"; range: AstRange; deviceKind: string; deviceId: number; propertyName: string | undefined };

/**
 * 互換: 旧 AST で ExpressionAst としていた参照と呼び出し。
 * メソッド引数では {@link MethodArgumentExpressionAst} を使用する。
 */
export type LegacyExpressionAst = IdentifierLegacyExpressionAst | CallExpressionAst;

export type IdentifierLegacyExpressionAst = {
  kind: "identifier_expression";
  range: AstRange;
  name: string;
};
