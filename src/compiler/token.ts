import type { SourcePosition } from "./source-text";

export type TokenKind =
  | "end_of_file"
  | "identifier"
  | "number_literal"
  | "string_literal"
  | "left_brace"
  | "right_brace"
  | "left_paren"
  | "right_paren"
  | "dot"
  | "comma"
  | "equals"
  | "hash"
  | "percent_keyword"
  | "deg_keyword"
  | "ms_keyword"
  | "unknown";

export type Token = {
  kind: TokenKind;
  lexeme: string;
  start: SourcePosition;
  end: SourcePosition;
};
