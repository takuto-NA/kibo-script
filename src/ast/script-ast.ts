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

export type TopLevelDeclarationAst = RefDeclarationAst | TaskDeclarationAst;

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

export type StatementAst = DoStatementAst;

export type DoStatementAst = {
  kind: "do_statement";
  range: AstRange;
  callExpression: CallExpressionAst;
};

export type ExpressionAst =
  | IdentifierExpressionAst
  | CallExpressionAst;

export type IdentifierExpressionAst = {
  kind: "identifier_expression";
  range: AstRange;
  name: string;
};

export type CallExpressionAst = {
  kind: "call_expression";
  range: AstRange;
  receiver: IdentifierExpressionAst;
  methodName: string;
  arguments: CallArgumentAst[];
};

export type CallArgumentAst =
  | {
      kind: "integer_argument";
      range: AstRange;
      value: number;
    }
  | {
      kind: "string_argument";
      range: AstRange;
      value: string;
    };
