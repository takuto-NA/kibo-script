import type {
  AstRange,
  CallExpressionAst,
  CallReceiverAst,
  DoStatementAst,
  MethodArgumentExpressionAst,
  ProgramAst,
  RefDeclarationAst,
  SetStatementAst,
  StateDeclarationAst,
  StatementAst,
  TaskDeclarationAst,
  TaskOnDeclarationAst,
  TopLevelDeclarationAst,
  WaitStatementAst,
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

export type ParseDoStatementLineResult =
  | { ok: true; doStatement: DoStatementAst }
  | { ok: false; report: DiagnosticReport };

/**
 * Parses token stream into AST for StaticCore Script compiler.
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

    if (current.lexeme === "state") {
      const stateDecl = parseStateDeclaration(cursor);
      if (stateDecl.ok === false) {
        return stateDecl;
      }
      declarations.push(stateDecl.declaration);
      continue;
    }

    if (current.lexeme === "task") {
      const taskDecl = parseTaskBranchAfterKeyword(cursor);
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

/**
 * interactive 1 行 `do ...` のみをパースする（先頭から `do`、末尾 EOF）。
 */
export function parseDoStatementLine(tokens: Token[], fileName: string): ParseDoStatementLineResult {
  const cursor = new ParserCursor(tokens, fileName);
  const statementResult = parseStatement(cursor);
  if (statementResult.ok === false) {
    return statementResult;
  }
  if (statementResult.statement.kind !== "do_statement") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnsupportedSyntax({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, cursor.current()),
          rangeText: cursor.current().lexeme,
          message: "Expected a do statement.",
        }),
      ]),
    };
  }
  if (!cursor.isAtEndOfFile()) {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, cursor.current()),
          rangeText: cursor.current().lexeme,
          message: "Unexpected token after do statement.",
        }),
      ]),
    };
  }
  return { ok: true, doStatement: statementResult.statement };
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

function parseStateDeclaration(
  cursor: ParserCursor,
): { ok: true; declaration: StateDeclarationAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const stateKeyword = cursor.current();
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
          message: "Expected state variable name after state.",
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
          message: "Expected '=' in state declaration.",
        }),
      ]),
    };
  }
  cursor.advance();

  const initResult = parseAdditiveExpression(cursor);
  if (initResult.ok === false) {
    return initResult;
  }

  const declarationRange: AstRange = {
    fileName,
    start: stateKeyword.start,
    end: initResult.expression.range.end,
  };

  return {
    ok: true,
    declaration: {
      kind: "state_declaration",
      range: declarationRange,
      stateName: nameToken.lexeme,
      initialValueExpression: initResult.expression,
    },
  };
}

function parseTaskBranchAfterKeyword(
  cursor: ParserCursor,
): { ok: true; declaration: TaskDeclarationAst | TaskOnDeclarationAst } | { ok: false; report: DiagnosticReport } {
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

  const branchToken = cursor.current();
  if (branchToken.kind === "identifier" && branchToken.lexeme === "every") {
    return parseTaskEveryAfterTaskName(cursor, taskKeyword, taskNameToken);
  }
  if (branchToken.kind === "identifier" && branchToken.lexeme === "on") {
    return parseTaskOnAfterTaskName(cursor, taskKeyword, taskNameToken);
  }

  return {
    ok: false,
    report: createDiagnosticReport([
      buildParseUnexpectedToken({
        file: fileName,
        range: tokenToDiagnosticRange(fileName, branchToken),
        rangeText: branchToken.lexeme,
        message: 'Expected "every" or "on" after task name.',
      }),
    ]),
  };
}

function parseTaskEveryAfterTaskName(
  cursor: ParserCursor,
  taskKeyword: Token,
  taskNameToken: Token,
): { ok: true; declaration: TaskDeclarationAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const everyToken = cursor.current();
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

function parseTaskOnAfterTaskName(
  cursor: ParserCursor,
  taskKeyword: Token,
  taskNameToken: Token,
): { ok: true; declaration: TaskOnDeclarationAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const onKeyword = cursor.current();
  cursor.advance();

  const deviceKindToken = cursor.current();
  if (deviceKindToken.kind !== "identifier") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, deviceKindToken),
          rangeText: deviceKindToken.lexeme,
          message: "Expected device kind for task on event.",
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
          message: "Expected '#' in task on event.",
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
          message: "Expected numeric device id in task on event.",
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
          message: "Expected '.' before event name.",
        }),
      ]),
    };
  }
  cursor.advance();

  const eventNameToken = cursor.current();
  if (eventNameToken.kind !== "identifier") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, eventNameToken),
          rangeText: eventNameToken.lexeme,
          message: "Expected event property name.",
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
          message: "Expected '{' before task on body.",
        }),
      ]),
    };
  }
  cursor.advance();

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
          message: "Expected '}' after task on body.",
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
      kind: "task_on_declaration",
      range: declarationRange,
      taskName: taskNameToken.lexeme,
      deviceKind: deviceKindToken.lexeme,
      deviceId: Number.parseInt(idToken.lexeme, 10),
      eventName: eventNameToken.lexeme,
      bodyStatements,
    },
  };
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

function parseStatement(
  cursor: ParserCursor,
):
  | { ok: true; statement: StatementAst }
  | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const leading = cursor.current();

  if (leading.kind === "identifier" && leading.lexeme === "do") {
    const doKeyword = leading;
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

    const doStatement: DoStatementAst = {
      kind: "do_statement",
      range: statementRange,
      callExpression: callResult.expression,
    };
    return { ok: true, statement: doStatement };
  }

  if (leading.kind === "identifier" && leading.lexeme === "set") {
    return parseSetStatement(cursor);
  }

  if (leading.kind === "identifier" && leading.lexeme === "wait") {
    return parseWaitStatement(cursor);
  }

  return {
    ok: false,
    report: createDiagnosticReport([
      buildParseUnsupportedSyntax({
        file: fileName,
        range: tokenToDiagnosticRange(fileName, leading),
        rangeText: leading.lexeme,
        message: "Unsupported statement: expected do, set, or wait.",
      }),
    ]),
  };
}

function parseSetStatement(
  cursor: ParserCursor,
): { ok: true; statement: SetStatementAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const setKeyword = cursor.current();
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
          message: "Expected state name after set.",
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
          message: "Expected '=' in set statement.",
        }),
      ]),
    };
  }
  cursor.advance();

  const valueResult = parseAdditiveExpression(cursor);
  if (valueResult.ok === false) {
    return valueResult;
  }

  const statementRange: AstRange = {
    fileName,
    start: setKeyword.start,
    end: valueResult.expression.range.end,
  };

  return {
    ok: true,
    statement: {
      kind: "set_statement",
      range: statementRange,
      stateName: nameToken.lexeme,
      valueExpression: valueResult.expression,
    },
  };
}

function parseWaitStatement(
  cursor: ParserCursor,
): { ok: true; statement: WaitStatementAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const waitKeyword = cursor.current();
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
          message: "Expected duration number after wait.",
        }),
      ]),
    };
  }
  cursor.advance();

  const unitToken = cursor.current();
  if (unitToken.kind !== "ms_keyword") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, unitToken),
          rangeText: unitToken.lexeme,
          message: 'Expected "ms" unit after wait duration.',
        }),
      ]),
    };
  }
  cursor.advance();

  const waitRange: AstRange = {
    fileName,
    start: numberToken.start,
    end: unitToken.end,
  };

  const statementRange: AstRange = {
    fileName,
    start: waitKeyword.start,
    end: unitToken.end,
  };

  return {
    ok: true,
    statement: {
      kind: "wait_statement",
      range: statementRange,
      waitMilliseconds: Number.parseInt(numberToken.lexeme, 10),
      waitRange,
    },
  };
}

function parseCallExpression(
  cursor: ParserCursor,
): { ok: true; expression: CallExpressionAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const receiverResult = parseCallReceiver(cursor);
  if (receiverResult.ok === false) {
    return receiverResult;
  }

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

  const callArguments: MethodArgumentExpressionAst[] = [];
  let closingParenToken = cursor.current();

  if (closingParenToken.kind === "right_paren") {
    cursor.advance();
  } else {
    while (true) {
      const argumentResult = parseAdditiveExpression(cursor);
      if (argumentResult.ok === false) {
        return argumentResult;
      }
      callArguments.push(argumentResult.expression);

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

  const callExpression: CallExpressionAst = {
    kind: "call_expression",
    range: {
      fileName,
      start: receiverResult.receiver.range.start,
      end: closingParenToken.end,
    },
    receiver: receiverResult.receiver,
    methodName: methodToken.lexeme,
    arguments: callArguments,
  };

  return { ok: true, expression: callExpression };
}

function parseCallReceiver(
  cursor: ParserCursor,
): { ok: true; receiver: CallReceiverAst } | { ok: false; report: DiagnosticReport } {
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

  const maybeHash = cursor.current();
  if (maybeHash.kind === "hash") {
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
            message: "Expected numeric device id after '#'.",
          }),
        ]),
      };
    }
    cursor.advance();

    const deviceReceiver: CallReceiverAst = {
      kind: "device_receiver",
      range: {
        fileName,
        start: receiverToken.start,
        end: idToken.end,
      },
      deviceKind: receiverToken.lexeme,
      deviceId: Number.parseInt(idToken.lexeme, 10),
    };
    return { ok: true, receiver: deviceReceiver };
  }

  const refReceiver: CallReceiverAst = {
    kind: "ref_receiver",
    range: {
      fileName,
      start: receiverToken.start,
      end: receiverToken.end,
    },
    name: receiverToken.lexeme,
  };
  return { ok: true, receiver: refReceiver };
}

function parseAdditiveExpression(
  cursor: ParserCursor,
): { ok: true; expression: MethodArgumentExpressionAst } | { ok: false; report: DiagnosticReport } {
  const firstPrimary = parsePrimaryExpression(cursor);
  if (firstPrimary.ok === false) {
    return firstPrimary;
  }

  let accumulated: MethodArgumentExpressionAst = firstPrimary.expression;
  const fileName = cursor.getSourceFileName();

  while (cursor.current().kind === "plus") {
    const plusToken = cursor.current();
    cursor.advance();
    const nextPrimary = parsePrimaryExpression(cursor);
    if (nextPrimary.ok === false) {
      return nextPrimary;
    }
    accumulated = {
      kind: "binary_add",
      range: {
        fileName,
        start: accumulated.range.start,
        end: nextPrimary.expression.range.end,
      },
      left: accumulated,
      right: nextPrimary.expression,
    };
  }

  return { ok: true, expression: accumulated };
}

function parsePrimaryExpression(
  cursor: ParserCursor,
): { ok: true; expression: MethodArgumentExpressionAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const token = cursor.current();

  if (token.kind === "number_literal") {
    cursor.advance();
    return {
      ok: true,
      expression: {
        kind: "integer_literal",
        range: { fileName, start: token.start, end: token.end },
        value: Number.parseInt(token.lexeme, 10),
      },
    };
  }

  if (token.kind === "string_literal") {
    cursor.advance();
    return {
      ok: true,
      expression: {
        kind: "string_literal",
        range: { fileName, start: token.start, end: token.end },
        value: token.lexeme,
      },
    };
  }

  if (token.kind === "identifier" && token.lexeme === "read") {
    return parseReadExpression(cursor);
  }

  if (token.kind === "identifier") {
    cursor.advance();
    return {
      ok: true,
      expression: {
        kind: "identifier_expression",
        range: { fileName, start: token.start, end: token.end },
        name: token.lexeme,
      },
    };
  }

  return {
    ok: false,
    report: createDiagnosticReport([
      buildParseUnexpectedToken({
        file: fileName,
        range: tokenToDiagnosticRange(fileName, token),
        rangeText: token.lexeme,
        message: "Expected expression.",
      }),
    ]),
  };
}

function parseReadExpression(
  cursor: ParserCursor,
): { ok: true; expression: MethodArgumentExpressionAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const readKeyword = cursor.current();
  cursor.advance();

  const deviceKindToken = cursor.current();
  if (deviceKindToken.kind !== "identifier") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, deviceKindToken),
          rangeText: deviceKindToken.lexeme,
          message: "Expected device kind after read.",
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
          message: "Expected '#' in read expression.",
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
          message: "Expected device id in read expression.",
        }),
      ]),
    };
  }
  cursor.advance();

  let propertyName: string | undefined;
  let expressionEnd = idToken.end;

  const maybeDot = cursor.current();
  if (maybeDot.kind === "dot") {
    cursor.advance();
    const propToken = cursor.current();
    if (propToken.kind !== "identifier") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, propToken),
            rangeText: propToken.lexeme,
            message: "Expected property name after '.'.",
          }),
        ]),
      };
    }
    cursor.advance();
    propertyName = propToken.lexeme;
    expressionEnd = propToken.end;
  }

  const readRange: AstRange = {
    fileName,
    start: readKeyword.start,
    end: expressionEnd,
  };

  return {
    ok: true,
    expression: {
      kind: "read_expression",
      range: readRange,
      readTarget: {
        kind: "device_read",
        range: readRange,
        deviceKind: deviceKindToken.lexeme,
        deviceId: Number.parseInt(idToken.lexeme, 10),
        propertyName,
      },
    },
  };
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
