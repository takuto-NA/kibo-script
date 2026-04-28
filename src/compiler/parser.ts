import type {
  AstRange,
  CallArgumentAst,
  CallExpressionAst,
  DoStatementAst,
  IdentifierExpressionAst,
  ProgramAst,
  RefDeclarationAst,
  StatementAst,
  TaskDeclarationAst,
  TopLevelDeclarationAst,
} from "../ast/script-ast";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import {
  buildParseUnexpectedToken,
  buildParseUnsupportedSyntax,
} from "../diagnostics/diagnostic-builder";
import type { Token } from "./token";

export type ParseProgramResult =
  | { ok: true; ast: ProgramAst }
  | { ok: false; report: DiagnosticReport };

/**
 * Parses token stream into AST for Phase 0 compiler (ref + task every + do call).
 */
export function parseProgram(tokens: Token[], fileName: string): ParseProgramResult {
  const cursor = new ParserCursor(tokens, fileName);
  const declarations: TopLevelDeclarationAst[] = [];

  if (cursor.isAtEndOfFile()) {
    const token = cursor.current();
    return {
      ok: true,
      ast: {
        kind: "program",
        range: singleTokenRange(fileName, token),
        declarations: [],
      },
    };
  }

  while (!cursor.isAtEndOfFile()) {
    const current = cursor.current();
    if (current.kind !== "identifier") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, current),
            rangeText: current.lexeme,
            message: "Expected top-level declaration.",
          }),
        ]),
      };
    }

    if (current.lexeme === "ref") {
      const refDecl = parseRefDeclaration(cursor);
      if (refDecl.ok === false) {
        return refDecl;
      }
      declarations.push(refDecl.declaration);
      continue;
    }

    if (current.lexeme === "task") {
      const taskDecl = parseTaskDeclaration(cursor);
      if (taskDecl.ok === false) {
        return taskDecl;
      }
      declarations.push(taskDecl.declaration);
      continue;
    }

    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnsupportedSyntax({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, current),
          rangeText: current.lexeme,
          message: "Unsupported top-level declaration.",
        }),
      ]),
    };
  }

  const firstDeclaration = declarations[0];
  const lastDeclaration = declarations[declarations.length - 1];
  const programRange: AstRange =
    firstDeclaration !== undefined && lastDeclaration !== undefined
      ? {
          fileName,
          start: firstDeclaration.range.start,
          end: lastDeclaration.range.end,
        }
      : singleTokenRange(fileName, tokens[0] ?? cursor.current());

  return {
    ok: true,
    ast: {
      kind: "program",
      range: programRange,
      declarations,
    },
  };
}

class ParserCursor {
  private readonly tokens: Token[];
  private readonly sourceFileName: string;
  private index: number;

  public constructor(tokens: Token[], sourceFileName: string) {
    this.tokens = tokens;
    this.sourceFileName = sourceFileName;
    this.index = 0;
  }

  public getSourceFileName(): string {
    return this.sourceFileName;
  }

  public current(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  public advance(): Token {
    const token = this.current();
    if (this.index < this.tokens.length - 1) {
      this.index += 1;
    }
    return token;
  }

  public isAtEndOfFile(): boolean {
    return this.current().kind === "end_of_file";
  }
}

function parseRefDeclaration(
  cursor: ParserCursor,
): { ok: true; declaration: RefDeclarationAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const refKeyword = cursor.current();
  cursor.advance();

  const nameToken = cursor.current();
  if (nameToken.kind !== "identifier") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, nameToken),
          rangeText: nameToken.lexeme,
          message: "Expected symbol name after ref.",
        }),
      ]),
    };
  }
  cursor.advance();

  const equalsToken = cursor.current();
  if (equalsToken.kind !== "equals") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, equalsToken),
          rangeText: equalsToken.lexeme,
          message: "Expected '=' in ref declaration.",
        }),
      ]),
    };
  }
  cursor.advance();

  const kindToken = cursor.current();
  if (kindToken.kind !== "identifier") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, kindToken),
          rangeText: kindToken.lexeme,
          message: "Expected device kind in ref declaration.",
        }),
      ]),
    };
  }
  cursor.advance();

  const hashToken = cursor.current();
  if (hashToken.kind !== "hash") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, hashToken),
          rangeText: hashToken.lexeme,
          message: "Expected '#' before device id.",
        }),
      ]),
    };
  }
  cursor.advance();

  const idToken = cursor.current();
  if (idToken.kind !== "number_literal") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, idToken),
          rangeText: idToken.lexeme,
          message: "Expected numeric device id.",
        }),
      ]),
    };
  }
  cursor.advance();

  const declarationRange: AstRange = {
    fileName,
    start: refKeyword.start,
    end: idToken.end,
  };

  return {
    ok: true,
    declaration: {
      kind: "ref_declaration",
      range: declarationRange,
      symbolName: nameToken.lexeme,
      deviceKind: kindToken.lexeme,
      deviceId: Number.parseInt(idToken.lexeme, 10),
    },
  };
}

function parseTaskDeclaration(
  cursor: ParserCursor,
): { ok: true; declaration: TaskDeclarationAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const taskKeyword = cursor.current();
  cursor.advance();

  const taskNameToken = cursor.current();
  if (taskNameToken.kind !== "identifier") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, taskNameToken),
          rangeText: taskNameToken.lexeme,
          message: "Expected task name.",
        }),
      ]),
    };
  }
  cursor.advance();

  const everyToken = cursor.current();
  if (everyToken.kind !== "identifier" || everyToken.lexeme !== "every") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, everyToken),
          rangeText: everyToken.lexeme,
          message: 'Expected keyword "every".',
        }),
      ]),
    };
  }
  cursor.advance();

  const numberToken = cursor.current();
  if (numberToken.kind !== "number_literal") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, numberToken),
          rangeText: numberToken.lexeme,
          message: "Expected numeric interval.",
        }),
      ]),
    };
  }
  cursor.advance();

  const unitToken = cursor.current();
  let intervalUnit: "ms" | "deg";
  if (unitToken.kind === "ms_keyword") {
    intervalUnit = "ms";
  } else if (unitToken.kind === "deg_keyword") {
    intervalUnit = "deg";
  } else {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, unitToken),
          rangeText: unitToken.lexeme,
          message: 'Expected time unit "ms" or "deg" after interval.',
        }),
      ]),
    };
  }
  cursor.advance();

  const leftBrace = cursor.current();
  if (leftBrace.kind !== "left_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, leftBrace),
          rangeText: leftBrace.lexeme,
          message: "Expected '{' before task body.",
        }),
      ]),
    };
  }
  cursor.advance();

  const intervalRange: AstRange = {
    fileName,
    start: numberToken.start,
    end: unitToken.end,
  };

  const bodyStatements: StatementAst[] = [];
  while (cursor.current().kind !== "right_brace" && !cursor.isAtEndOfFile()) {
    const statementResult = parseStatement(cursor);
    if (statementResult.ok === false) {
      return statementResult;
    }
    bodyStatements.push(statementResult.statement);
  }

  const closeBrace = cursor.current();
  if (closeBrace.kind !== "right_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, closeBrace),
          rangeText: closeBrace.lexeme,
          message: "Expected '}' after task body.",
        }),
      ]),
    };
  }
  cursor.advance();

  const declarationRange: AstRange = {
    fileName,
    start: taskKeyword.start,
    end: closeBrace.end,
  };

  return {
    ok: true,
    declaration: {
      kind: "task_declaration",
      range: declarationRange,
      taskName: taskNameToken.lexeme,
      intervalValue: Number.parseInt(numberToken.lexeme, 10),
      intervalUnit,
      intervalRange,
      bodyStatements,
    },
  };
}

function parseStatement(
  cursor: ParserCursor,
): { ok: true; statement: DoStatementAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const doKeyword = cursor.current();
  if (doKeyword.kind !== "identifier" || doKeyword.lexeme !== "do") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnsupportedSyntax({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, doKeyword),
          rangeText: doKeyword.lexeme,
          message: "Only do statements are supported in task body for now.",
        }),
      ]),
    };
  }
  cursor.advance();

  const callResult = parseCallExpression(cursor);
  if (callResult.ok === false) {
    return callResult;
  }

  const statementRange: AstRange = {
    fileName,
    start: doKeyword.start,
    end: callResult.expression.range.end,
  };

  return {
    ok: true,
    statement: {
      kind: "do_statement",
      range: statementRange,
      callExpression: callResult.expression,
    },
  };
}

function parseCallExpression(
  cursor: ParserCursor,
): { ok: true; expression: CallExpressionAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const receiverToken = cursor.current();
  if (receiverToken.kind !== "identifier") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, receiverToken),
          rangeText: receiverToken.lexeme,
          message: "Expected receiver before '.'.",
        }),
      ]),
    };
  }
  cursor.advance();

  const dotToken = cursor.current();
  if (dotToken.kind !== "dot") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, dotToken),
          rangeText: dotToken.lexeme,
          message: "Expected '.' before method name.",
        }),
      ]),
    };
  }
  cursor.advance();

  const methodToken = cursor.current();
  if (methodToken.kind !== "identifier") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, methodToken),
          rangeText: methodToken.lexeme,
          message: "Expected method name.",
        }),
      ]),
    };
  }
  cursor.advance();

  const leftParen = cursor.current();
  if (leftParen.kind !== "left_paren") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, leftParen),
          rangeText: leftParen.lexeme,
          message: "Expected '(' after method name.",
        }),
      ]),
    };
  }
  cursor.advance();

  const callArguments: CallArgumentAst[] = [];
  let closingParenToken = cursor.current();

  if (closingParenToken.kind === "right_paren") {
    cursor.advance();
  } else {
    while (true) {
      const argumentToken = cursor.current();
      if (argumentToken.kind === "number_literal") {
        cursor.advance();
        callArguments.push({
          kind: "integer_argument",
          range: {
            fileName,
            start: argumentToken.start,
            end: argumentToken.end,
          },
          value: Number.parseInt(argumentToken.lexeme, 10),
        });
      } else if (argumentToken.kind === "string_literal") {
        cursor.advance();
        callArguments.push({
          kind: "string_argument",
          range: {
            fileName,
            start: argumentToken.start,
            end: argumentToken.end,
          },
          value: argumentToken.lexeme,
        });
      } else {
        return {
          ok: false,
          report: createDiagnosticReport([
            buildParseUnsupportedSyntax({
              file: fileName,
              range: tokenToDiagnosticRange(fileName, argumentToken),
              rangeText: argumentToken.lexeme,
              message:
                "Only integer and string literals are supported as method arguments in Phase 0.",
            }),
          ]),
        };
      }

      const separatorToken = cursor.current();
      if (separatorToken.kind === "right_paren") {
        closingParenToken = separatorToken;
        cursor.advance();
        break;
      }
      if (separatorToken.kind === "comma") {
        cursor.advance();
        continue;
      }
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, separatorToken),
            rangeText: separatorToken.lexeme,
            message: "Expected ',' or ')' after method argument.",
          }),
        ]),
      };
    }
  }

  const receiverExpression: IdentifierExpressionAst = {
    kind: "identifier_expression",
    range: {
      fileName,
      start: receiverToken.start,
      end: receiverToken.end,
    },
    name: receiverToken.lexeme,
  };

  const callExpression: CallExpressionAst = {
    kind: "call_expression",
    range: {
      fileName,
      start: receiverToken.start,
      end: closingParenToken.end,
    },
    receiver: receiverExpression,
    methodName: methodToken.lexeme,
    arguments: callArguments,
  };

  return { ok: true, expression: callExpression };
}

function tokenToDiagnosticRange(fileName: string, token: Token) {
  return {
    file: fileName,
    start: token.start,
    end: token.end,
  };
}

function singleTokenRange(fileName: string, token: Token): AstRange {
  return {
    fileName,
    start: token.start,
    end: token.end,
  };
}

