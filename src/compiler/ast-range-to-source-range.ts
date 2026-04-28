/**
 * AST の範囲を診断用の SourceRange に変換する（重複定義の防止用）。
 */

import type { AstRange } from "../ast/script-ast";
import type { SourceRange } from "../diagnostics/diagnostic";

export function convertAstRangeToSourceRange(astRange: AstRange): SourceRange {
  return {
    file: astRange.fileName,
    start: astRange.start,
    end: astRange.end,
  };
}
