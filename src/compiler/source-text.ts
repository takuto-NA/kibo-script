/**
 * Source text wrapper for line/column/offset tracking in the compiler.
 */

export type SourcePosition = {
  line: number;
  column: number;
  offset: number;
};

export type SourceRange = {
  fileName: string;
  start: SourcePosition;
  end: SourcePosition;
};

export function createSourceRange(params: {
  fileName: string;
  start: SourcePosition;
  end: SourcePosition;
}): SourceRange {
  return {
    fileName: params.fileName,
    start: params.start,
    end: params.end,
  };
}
