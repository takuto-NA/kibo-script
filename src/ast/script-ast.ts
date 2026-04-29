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
  | ConstDeclarationAst
  | TaskOnDeclarationAst
  | AnimatorDeclarationAst;

/** `const name = <expr>` — program 全体で不変 */
export type ConstDeclarationAst = {
  kind: "const_declaration";
  range: AstRange;
  constName: string;
  initialValueExpression: MethodArgumentExpressionAst;
};

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

/**
 * `task <name> every ...` か `task <name> loop` のスケジュール。
 * loop は周期を持たず、本体末尾で先頭へ戻る。
 */
export type TaskScheduleAst =
  | {
      kind: "every";
      /** Raw integer before unit token. */
      intervalValue: number;
      /** `ms` for time schedule, or invalid unit for diagnostic tests. */
      intervalUnit: "ms" | "deg";
      intervalRange: AstRange;
    }
  | {
      kind: "loop";
      /** `loop` キーワードの範囲（診断用）。 */
      loopKeywordRange: AstRange;
    };

export type TaskDeclarationAst = {
  kind: "task_declaration";
  range: AstRange;
  taskName: string;
  schedule: TaskScheduleAst;
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

/** `ramp from A% to B% over ...`（固定端点 one-shot） */
export type AnimatorRampFromToAst = {
  kind: "ramp_from_to";
  fromPercent: number;
  toPercent: number;
  fromPercentRange: AstRange;
  toPercentRange: AstRange;
};

/** `ramp over Nms ...`（目標は `step anim with <expr> dt` で与える） */
export type AnimatorRampOverOnlyAst = {
  kind: "ramp_over_only";
};

/**
 * animator 宣言: `ramp from ... to ... over ...` または `ramp over ...`
 */
export type AnimatorDeclarationAst = {
  kind: "animator_declaration";
  range: AstRange;
  animatorName: string;
  ramp: AnimatorRampFromToAst | AnimatorRampOverOnlyAst;
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
  | MatchStatementAst
  | TempStatementAst
  | IfStatementAst;

/** `temp name = <expr>` — task 実行内の局所一時（宣言順にのみ参照可） */
export type TempStatementAst = {
  kind: "temp_statement";
  range: AstRange;
  tempName: string;
  valueExpression: MethodArgumentExpressionAst;
};

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
  /**
   * `ms` までの待機時間（整数式）。リテラル `wait 100ms` も式として表現する。
   */
  durationMillisecondsExpression: MethodArgumentExpressionAst;
  /** 式の開始から `ms` トークン終端まで（診断用）。 */
  waitRange: AstRange;
};

/** `if <comparison> { ... } else { ... }` — 条件は比較式のみ（Phase 1） */
export type IfStatementAst = {
  kind: "if_statement";
  range: AstRange;
  conditionExpression: MethodArgumentExpressionAst;
  thenBodyStatements: StatementAst[];
  elseBodyStatements: StatementAst[];
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
  /** `step <animator> with dt` または `step <animator> with <expr> dt` */
  | {
      kind: "step_animator_expression";
      range: AstRange;
      animatorName: string;
      /** 省略時は固定端点 animator 向けの one-shot step */
      targetExpression?: MethodArgumentExpressionAst;
    }
  | { kind: "binary_add"; range: AstRange; left: MethodArgumentExpressionAst; right: MethodArgumentExpressionAst }
  | { kind: "binary_sub"; range: AstRange; left: MethodArgumentExpressionAst; right: MethodArgumentExpressionAst }
  | { kind: "binary_mul"; range: AstRange; left: MethodArgumentExpressionAst; right: MethodArgumentExpressionAst }
  | { kind: "binary_div"; range: AstRange; left: MethodArgumentExpressionAst; right: MethodArgumentExpressionAst }
  | { kind: "unary_minus"; range: AstRange; operand: MethodArgumentExpressionAst }
  | {
      kind: "comparison";
      range: AstRange;
      operator: "==" | "!=" | "<" | "<=" | ">" | ">=";
      left: MethodArgumentExpressionAst;
      right: MethodArgumentExpressionAst;
    }
  | {
      kind: "match_expression";
      range: AstRange;
      scrutinee: MethodArgumentExpressionAst;
      arms: MatchExpressionArmAst[];
      /** 省略時は arms が網羅的である必要がある（実装で診断） */
      elseResultExpression?: MethodArgumentExpressionAst;
    }
  | { kind: "read_expression"; range: AstRange; readTarget: ReadTargetAst };

export type MatchExpressionArmAst = {
  range: AstRange;
  pattern: MatchNumericPatternAst;
  resultExpression: MethodArgumentExpressionAst;
};

/** range は左閉右開。`..b` は start なし、`a..` は end なし */
export type MatchNumericPatternAst =
  | {
      kind: "equality_pattern";
      range: AstRange;
      /** 単一値との一致（literal / identifier / 簡単な式） */
      compareExpression: MethodArgumentExpressionAst;
    }
  | {
      kind: "range_pattern";
      range: AstRange;
      /** 省略時は無限下限（integer のみを型チェックで許可） */
      startInclusive?: MethodArgumentExpressionAst;
      /** 省略時は無限上限 */
      endExclusive?: MethodArgumentExpressionAst;
    };

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
