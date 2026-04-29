import type { DiagnosticReport } from "../diagnostics/diagnostic";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import { buildParseUnexpectedToken } from "../diagnostics/diagnostic-builder";
import type { SourcePosition } from "./source-text";
import type { Token, TokenKind } from "./token";

export type LexResult =
  | { ok: true; tokens: Token[] }
  | { ok: false; report: DiagnosticReport };

const NEWLINE_CODE_UNIT = 10;

/**
 * Tokenizes StaticCore Script source into tokens with source positions.
 */
export function lexSourceText(sourceText: string, fileName: string): LexResult {
  const tokens: Token[] = [];

  function positionAt(startOffset: number): SourcePosition {
    let lineNumber = 1;
    let columnNumber = 1;
    for (let index = 0; index < startOffset; index += 1) {
      const codeUnit = sourceText.charCodeAt(index);
      if (codeUnit === NEWLINE_CODE_UNIT) {
        lineNumber += 1;
        columnNumber = 1;
      } else {
        columnNumber += 1;
      }
    }
    return { line: lineNumber, column: columnNumber, offset: startOffset };
  }

  function makeRange(startOffset: number, endOffsetExclusive: number): {
    start: SourcePosition;
    end: SourcePosition;
  } {
    return {
      start: positionAt(startOffset),
      end: positionAt(endOffsetExclusive),
    };
  }

  let offset = 0;

  while (offset < sourceText.length) {
    const character = sourceText[offset];

    if (character === " " || character === "\t" || character === "\r") {
      offset += 1;
      continue;
    }

    if (character === "\n") {
      offset += 1;
      continue;
    }

    if (character === "/" && sourceText[offset + 1] === "/") {
      while (offset < sourceText.length && sourceText[offset] !== "\n") {
        offset += 1;
      }
      continue;
    }

    const tokenStartOffset = offset;
    const tokenStartPosition = positionAt(tokenStartOffset);

    if (character === "{") {
      offset += 1;
      tokens.push({
        kind: "left_brace",
        lexeme: "{",
        start: tokenStartPosition,
        end: positionAt(offset),
      });
      continue;
    }
    if (character === "}") {
      offset += 1;
      tokens.push({
        kind: "right_brace",
        lexeme: "}",
        start: tokenStartPosition,
        end: positionAt(offset),
      });
      continue;
    }
    if (character === "(") {
      offset += 1;
      tokens.push({
        kind: "left_paren",
        lexeme: "(",
        start: tokenStartPosition,
        end: positionAt(offset),
      });
      continue;
    }
    if (character === ")") {
      offset += 1;
      tokens.push({
        kind: "right_paren",
        lexeme: ")",
        start: tokenStartPosition,
        end: positionAt(offset),
      });
      continue;
    }
    if (character === ".") {
      offset += 1;
      tokens.push({
        kind: "dot",
        lexeme: ".",
        start: tokenStartPosition,
        end: positionAt(offset),
      });
      continue;
    }
    if (character === ",") {
      offset += 1;
      tokens.push({
        kind: "comma",
        lexeme: ",",
        start: tokenStartPosition,
        end: positionAt(offset),
      });
      continue;
    }
    if (character === "+") {
      offset += 1;
      tokens.push({
        kind: "plus",
        lexeme: "+",
        start: tokenStartPosition,
        end: positionAt(offset),
      });
      continue;
    }
    if (character === "=") {
      if (sourceText[offset + 1] === ">") {
        offset += 2;
        tokens.push({
          kind: "fat_arrow",
          lexeme: "=>",
          start: tokenStartPosition,
          end: positionAt(offset),
        });
        continue;
      }
      offset += 1;
      tokens.push({
        kind: "equals",
        lexeme: "=",
        start: tokenStartPosition,
        end: positionAt(offset),
      });
      continue;
    }
    if (character === "#") {
      offset += 1;
      tokens.push({
        kind: "hash",
        lexeme: "#",
        start: tokenStartPosition,
        end: positionAt(offset),
      });
      continue;
    }

    if (character === '"') {
      offset += 1;
      let stringContent = "";
      while (offset < sourceText.length && sourceText[offset] !== '"') {
        if (sourceText[offset] === "\\" && sourceText[offset + 1] === '"') {
          stringContent += '"';
          offset += 2;
          continue;
        }
        stringContent += sourceText[offset];
        offset += 1;
      }
      if (offset >= sourceText.length || sourceText[offset] !== '"') {
        const rangeEnd = offset;
        const diagnosticRange = makeRange(tokenStartOffset, rangeEnd);
        return {
          ok: false,
          report: createDiagnosticReport([
            buildParseUnexpectedToken({
              file: fileName,
              range: {
                file: fileName,
                start: diagnosticRange.start,
                end: diagnosticRange.end,
              },
              rangeText: sourceText.slice(tokenStartOffset, rangeEnd),
              message: "Unterminated string literal.",
            }),
          ]),
        };
      }
      offset += 1;
      tokens.push({
        kind: "string_literal",
        lexeme: stringContent,
        start: tokenStartPosition,
        end: positionAt(offset),
      });
      continue;
    }

    if (character >= "0" && character <= "9") {
      let numberText = "";
      while (offset < sourceText.length) {
        const digitCharacter = sourceText[offset];
        if (digitCharacter < "0" || digitCharacter > "9") {
          break;
        }
        numberText += digitCharacter;
        offset += 1;
      }
      tokens.push({
        kind: "number_literal",
        lexeme: numberText,
        start: tokenStartPosition,
        end: positionAt(offset),
      });
      continue;
    }

    if (isIdentifierStart(character)) {
      let identifierText = "";
      while (offset < sourceText.length) {
        const identifierCharacter = sourceText[offset];
        if (!isIdentifierContinue(identifierCharacter)) {
          break;
        }
        identifierText += identifierCharacter;
        offset += 1;
      }
      const unitKind = mapIdentifierToUnitKeyword(identifierText);
      if (unitKind !== undefined) {
        tokens.push({
          kind: unitKind,
          lexeme: identifierText,
          start: tokenStartPosition,
          end: positionAt(offset),
        });
      } else {
        tokens.push({
          kind: "identifier",
          lexeme: identifierText,
          start: tokenStartPosition,
          end: positionAt(offset),
        });
      }
      continue;
    }

    const unexpectedEnd = offset + 1;
    const diagnosticRange = makeRange(tokenStartOffset, unexpectedEnd);
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: {
            file: fileName,
            start: diagnosticRange.start,
            end: diagnosticRange.end,
          },
          rangeText: character,
          message: `Unexpected character: ${character}`,
        }),
      ]),
    };
  }

  const endPosition = positionAt(offset);
  tokens.push({
    kind: "end_of_file",
    lexeme: "",
    start: endPosition,
    end: endPosition,
  });

  return { ok: true, tokens };
}

function isIdentifierStart(character: string): boolean {
  return /[a-zA-Z_]/.test(character);
}

function isIdentifierContinue(character: string): boolean {
  return /[a-zA-Z0-9_]/.test(character);
}

function mapIdentifierToUnitKeyword(text: string): TokenKind | undefined {
  if (text === "ms") {
    return "ms_keyword";
  }
  if (text === "deg") {
    return "deg_keyword";
  }
  return undefined;
}
