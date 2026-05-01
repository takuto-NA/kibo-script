import type {
  AstRange,
  AnimatorDeclarationAst,
  AnimatorRampFromToAst,
  AnimatorRampOverOnlyAst,
  CallExpressionAst,
  CallReceiverAst,
  ConstDeclarationAst,
  DoStatementAst,
  IfStatementAst,
  MatchExpressionArmAst,
  MatchNumericPatternAst,
  MatchStatementAst,
  MethodArgumentExpressionAst,
  ProgramAst,
  RefDeclarationAst,
  SetStatementAst,
  StateMachineDeclarationAst,
  StatementAst,
  TaskDeclarationAst,
  TaskOnDeclarationAst,
  TaskOnEventTargetAst,
  TaskStateMembershipAst,
  TopLevelDeclarationAst,
  VarDeclarationAst,
  WaitStatementAst,
} from "../ast/script-ast";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import {
  buildMatchMissingElseBranch,
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

    if (current.lexeme === "const") {
      const constDecl = parseConstDeclaration(cursor);
      if (constDecl.ok === false) {
        return constDecl;
      }
      declarations.push(constDecl.declaration);
      continue;
    }

    if (current.lexeme === "var") {
      const varDecl = parseVarDeclaration(cursor);
      if (varDecl.ok === false) {
        return varDecl;
      }
      declarations.push(varDecl.declaration);
      continue;
    }

    if (current.lexeme === "state") {
      const stateDecl = parseStateOrRejectLegacyPersistent(cursor);
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

    if (current.lexeme === "animator") {
      const animatorDecl = parseAnimatorDeclaration(cursor);
      if (animatorDecl.ok === false) {
        return animatorDecl;
      }
      declarations.push(animatorDecl.declaration);
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

  /** 現在位置から offset 先のトークン（EOF にはフォールバックしない）。 */
  public peekAhead(offset: number): Token {
    const idx = this.index + offset;
    if (idx >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1]!;
    }
    return this.tokens[idx]!;
  }
}

function parseVarDeclaration(
  cursor: ParserCursor,
): { ok: true; declaration: VarDeclarationAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const varKeyword = cursor.current();
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
          message: "Expected variable name after var.",
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
          message: "Expected '=' in var declaration.",
        }),
      ]),
    };
  }
  cursor.advance();

  const initResult = parseExpression(cursor);
  if (initResult.ok === false) {
    return initResult;
  }

  const declarationRange: AstRange = {
    fileName,
    start: varKeyword.start,
    end: initResult.expression.range.end,
  };

  return {
    ok: true,
    declaration: {
      kind: "var_declaration",
      range: declarationRange,
      varName: nameToken.lexeme,
      initialValueExpression: initResult.expression,
    },
  };
}

/**
 * `state` は階層状態機械のみ。旧 `state name = expr` は拒否する。
 */
function parseStateOrRejectLegacyPersistent(
  cursor: ParserCursor,
): { ok: true; declaration: StateMachineDeclarationAst } | { ok: false; report: DiagnosticReport } {
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
          message: "Expected state machine name after state.",
        }),
      ]),
    };
  }

  const nextAfterName = cursor.peekAhead(1);
  if (nextAfterName.kind === "equals") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnsupportedSyntax({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, stateKeyword),
          rangeText: "state",
          message:
            "Persistent values use `var`, not `state`. Replace `state name = ...` with `var name = ...`. State machines use `state Name every ... initial Path { ... }`.",
        }),
      ]),
    };
  }

  return parseStateMachineDeclaration(cursor, stateKeyword, nameToken);
}

function parseStateMachineDeclaration(
  cursor: ParserCursor,
  stateKeyword: Token,
  machineNameToken: Token,
): { ok: true; declaration: StateMachineDeclarationAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  cursor.advance();

  const everyTok = cursor.current();
  if (everyTok.kind !== "identifier" || everyTok.lexeme !== "every") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, everyTok),
          rangeText: everyTok.lexeme,
          message: 'Expected "every" after state machine name.',
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
          message: "Expected numeric interval for state machine tick.",
        }),
      ]),
    };
  }
  cursor.advance();

  const unitToken = cursor.current();
  let tickIntervalUnit: "ms" | "deg";
  if (unitToken.kind === "ms_keyword") {
    tickIntervalUnit = "ms";
  } else if (unitToken.kind === "deg_keyword") {
    tickIntervalUnit = "deg";
  } else {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, unitToken),
          rangeText: unitToken.lexeme,
          message: 'Expected "ms" or "deg" after state machine interval.',
        }),
      ]),
    };
  }
  cursor.advance();

  const tickIntervalRange: AstRange = {
    fileName,
    start: numberToken.start,
    end: unitToken.end,
  };

  const initialTok = cursor.current();
  if (initialTok.kind !== "identifier" || initialTok.lexeme !== "initial") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, initialTok),
          rangeText: initialTok.lexeme,
          message: 'Expected "initial" before initial state path.',
        }),
      ]),
    };
  }
  cursor.advance();

  const initialPathResult = parseAbsoluteStatePath(cursor);
  if (initialPathResult.ok === false) {
    return initialPathResult;
  }

  const openBrace = cursor.current();
  if (openBrace.kind !== "left_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, openBrace),
          rangeText: openBrace.lexeme,
          message: "Expected '{' before state machine body.",
        }),
      ]),
    };
  }
  cursor.advance();

  const bodyItemsResult = parseStateMachineBodyItems(cursor, machineNameToken.lexeme);
  if (bodyItemsResult.ok === false) {
    return bodyItemsResult;
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
          message: "Expected '}' after state machine body.",
        }),
      ]),
    };
  }
  cursor.advance();

  const declarationRange: AstRange = {
    fileName,
    start: stateKeyword.start,
    end: closeBrace.end,
  };

  return {
    ok: true,
    declaration: {
      kind: "state_machine_declaration",
      range: declarationRange,
      machineName: machineNameToken.lexeme,
      tickIntervalValue: Number.parseInt(numberToken.lexeme, 10),
      tickIntervalUnit,
      tickIntervalRange,
      initialStatePathText: initialPathResult.pathText,
      initialStatePathRange: initialPathResult.pathRange,
      bodyItems: bodyItemsResult.items,
    },
  };
}

function parseAbsoluteStatePath(
  cursor: ParserCursor,
): { ok: true; pathText: string; pathRange: AstRange } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const first = cursor.current();
  if (first.kind !== "identifier") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, first),
          rangeText: first.lexeme,
          message: "Expected state path segment.",
        }),
      ]),
    };
  }
  let pathText = first.lexeme;
  let rangeEnd = first.end;
  cursor.advance();

  while (cursor.current().kind === "dot") {
    cursor.advance();
    const seg = cursor.current();
    if (seg.kind !== "identifier") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, seg),
            rangeText: seg.lexeme,
            message: "Expected identifier after '.' in state path.",
          }),
        ]),
      };
    }
    pathText = `${pathText}.${seg.lexeme}`;
    rangeEnd = seg.end;
    cursor.advance();
  }

  const pathRange: AstRange = {
    fileName,
    start: first.start,
    end: rangeEnd,
  };

  return { ok: true, pathText, pathRange };
}

function parseStateMachineBodyItems(
  cursor: ParserCursor,
  machineName: string,
): { ok: true; items: import("../ast/script-ast").StateMachineBodyItemAst[] } | { ok: false; report: DiagnosticReport } {
  const items: import("../ast/script-ast").StateMachineBodyItemAst[] = [];
  const fileName = cursor.getSourceFileName();

  while (cursor.current().kind !== "right_brace" && !cursor.isAtEndOfFile()) {
    const tok = cursor.current();
    if (tok.kind === "identifier" && tok.lexeme === "on") {
      const globalResult = parseStateMachineTransition(cursor);
      if (globalResult.ok === false) {
        return globalResult;
      }
      items.push(globalResult.item);
      continue;
    }
    if (tok.kind === "identifier") {
      const blockResult = parseStateMachineStateBlock(cursor, machineName);
      if (blockResult.ok === false) {
        return blockResult;
      }
      items.push(blockResult.block);
      continue;
    }
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, tok),
          rangeText: tok.lexeme,
          message: "Expected 'on' transition or state block in state machine body.",
        }),
      ]),
    };
  }

  return { ok: true, items };
}

function parseStateMachineTransition(
  cursor: ParserCursor,
): { ok: true; item: import("../ast/script-ast").StateMachineGlobalTransitionAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const onTok = cursor.current();
  cursor.advance();

  const condResult = parseExpression(cursor);
  if (condResult.ok === false) {
    return condResult;
  }

  const arrowResult = parseThinArrow(cursor);
  if (arrowResult.ok === false) {
    return arrowResult;
  }

  const targetResult = parseAbsoluteStatePath(cursor);
  if (targetResult.ok === false) {
    return targetResult;
  }

  const itemRange: AstRange = {
    fileName,
    start: onTok.start,
    end: targetResult.pathRange.end,
  };

  return {
    ok: true,
    item: {
      kind: "state_machine_global_transition",
      range: itemRange,
      conditionExpression: condResult.expression,
      targetStatePathText: targetResult.pathText,
      targetStatePathRange: targetResult.pathRange,
    },
  };
}

function parseThinArrow(cursor: ParserCursor): { ok: true } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const m = cursor.current();
  if (m.kind !== "minus") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, m),
          rangeText: m.lexeme,
          message: "Expected '->' (thin arrow).",
        }),
      ]),
    };
  }
  cursor.advance();
  const g = cursor.current();
  if (g.kind !== "greater") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, g),
          rangeText: g.lexeme,
          message: "Expected '->' (thin arrow).",
        }),
      ]),
    };
  }
  cursor.advance();
  return { ok: true };
}

function parseStateMachineStateBlock(
  cursor: ParserCursor,
  machineName: string,
): { ok: true; block: import("../ast/script-ast").StateMachineStateBlockAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const nameTok = cursor.current();
  if (nameTok.kind !== "identifier") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, nameTok),
          rangeText: nameTok.lexeme,
          message: "Expected state name.",
        }),
      ]),
    };
  }
  cursor.advance();

  let initialChildPathText: string | undefined;
  let initialChildPathRange: AstRange | undefined;

  const maybeInitial = cursor.current();
  if (maybeInitial.kind === "identifier" && maybeInitial.lexeme === "initial") {
    cursor.advance();
    const pathResult = parseAbsoluteStatePath(cursor);
    if (pathResult.ok === false) {
      return pathResult;
    }
    initialChildPathText = pathResult.pathText;
    initialChildPathRange = pathResult.pathRange;
  }

  const open = cursor.current();
  if (open.kind !== "left_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, open),
          rangeText: open.lexeme,
          message: "Expected '{' before state body.",
        }),
      ]),
    };
  }
  cursor.advance();

  const nestedItems: import("../ast/script-ast").StateMachineNestedItemAst[] = [];

  while (cursor.current().kind !== "right_brace" && !cursor.isAtEndOfFile()) {
    const t = cursor.current();
    if (t.kind === "identifier" && t.lexeme === "on") {
      const locResult = parseStateMachineLocalTransition(cursor);
      if (locResult.ok === false) {
        return locResult;
      }
      nestedItems.push(locResult.item);
      continue;
    }
    if (t.kind === "identifier") {
      const childBlock = parseStateMachineStateBlock(cursor, machineName);
      if (childBlock.ok === false) {
        return childBlock;
      }
      nestedItems.push(childBlock.block);
      continue;
    }
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, t),
          rangeText: t.lexeme,
          message: "Expected 'on' or nested state in state body.",
        }),
      ]),
    };
  }

  const close = cursor.current();
  if (close.kind !== "right_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, close),
          rangeText: close.lexeme,
          message: "Expected '}' after state body.",
        }),
      ]),
    };
  }
  cursor.advance();

  const blockRange: AstRange = {
    fileName,
    start: nameTok.start,
    end: close.end,
  };

  return {
    ok: true,
    block: {
      kind: "state_machine_state_block",
      range: blockRange,
      stateName: nameTok.lexeme,
      initialChildStatePathText: initialChildPathText,
      initialChildStatePathRange: initialChildPathRange,
      items: nestedItems,
    },
  };
}

function parseStateMachineLocalTransition(
  cursor: ParserCursor,
): { ok: true; item: import("../ast/script-ast").StateMachineLocalTransitionAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const onTok = cursor.current();
  cursor.advance();

  const condResult = parseExpression(cursor);
  if (condResult.ok === false) {
    return condResult;
  }

  const arrowResult = parseThinArrow(cursor);
  if (arrowResult.ok === false) {
    return arrowResult;
  }

  const targetResult = parseAbsoluteStatePath(cursor);
  if (targetResult.ok === false) {
    return targetResult;
  }

  const itemRange: AstRange = {
    fileName,
    start: onTok.start,
    end: targetResult.pathRange.end,
  };

  return {
    ok: true,
    item: {
      kind: "state_machine_local_transition",
      range: itemRange,
      conditionExpression: condResult.expression,
      targetStatePathText: targetResult.pathText,
      targetStatePathRange: targetResult.pathRange,
    },
  };
}

function parseConstDeclaration(
  cursor: ParserCursor,
): { ok: true; declaration: ConstDeclarationAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const constKeyword = cursor.current();
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
          message: "Expected const name after const.",
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
          message: "Expected '=' in const declaration.",
        }),
      ]),
    };
  }
  cursor.advance();

  const initResult = parseExpression(cursor);
  if (initResult.ok === false) {
    return initResult;
  }

  const declarationRange: AstRange = {
    fileName,
    start: constKeyword.start,
    end: initResult.expression.range.end,
  };

  return {
    ok: true,
    declaration: {
      kind: "const_declaration",
      range: declarationRange,
      constName: nameToken.lexeme,
      initialValueExpression: initResult.expression,
    },
  };
}

function parsePercentLiteral(
  cursor: ParserCursor,
):
  | { ok: true; value: number; range: AstRange }
  | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const numberToken = cursor.current();
  if (numberToken.kind !== "number_literal") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, numberToken),
          rangeText: numberToken.lexeme,
          message: "Expected numeric percent literal before '%'.",
        }),
      ]),
    };
  }
  cursor.advance();

  const percentToken = cursor.current();
  if (percentToken.kind !== "percent_sign") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, percentToken),
          rangeText: percentToken.lexeme,
          message: "Expected '%' after number for percent literal.",
        }),
      ]),
    };
  }
  cursor.advance();

  const literalRange: AstRange = {
    fileName,
    start: numberToken.start,
    end: percentToken.end,
  };

  return {
    ok: true,
    value: Number.parseInt(numberToken.lexeme, 10),
    range: literalRange,
  };
}

function parseAnimatorDeclaration(
  cursor: ParserCursor,
): { ok: true; declaration: AnimatorDeclarationAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const animatorKeywordToken = cursor.current();
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
          message: "Expected animator name after 'animator'.",
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
          message: "Expected '=' in animator declaration.",
        }),
      ]),
    };
  }
  cursor.advance();

  const rampToken = cursor.current();
  if (rampToken.kind !== "identifier" || rampToken.lexeme !== "ramp") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, rampToken),
          rangeText: rampToken.lexeme,
          message: "Expected 'ramp' in animator declaration.",
        }),
      ]),
    };
  }
  cursor.advance();

  const branchToken = cursor.current();
  let rampAst: AnimatorRampFromToAst | AnimatorRampOverOnlyAst;

  if (branchToken.kind === "identifier" && branchToken.lexeme === "from") {
    cursor.advance();

    const fromPercentResult = parsePercentLiteral(cursor);
    if (fromPercentResult.ok === false) {
      return fromPercentResult;
    }

    const toKwToken = cursor.current();
    if (toKwToken.kind !== "identifier" || toKwToken.lexeme !== "to") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, toKwToken),
            rangeText: toKwToken.lexeme,
            message: "Expected 'to' in animator ramp.",
          }),
        ]),
      };
    }
    cursor.advance();

    const toPercentResult = parsePercentLiteral(cursor);
    if (toPercentResult.ok === false) {
      return toPercentResult;
    }

    const overAfterFromToToken = cursor.current();
    if (overAfterFromToToken.kind !== "identifier" || overAfterFromToToken.lexeme !== "over") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, overAfterFromToToken),
            rangeText: overAfterFromToToken.lexeme,
            message: "Expected 'over' before animator duration.",
          }),
        ]),
      };
    }
    cursor.advance();

    rampAst = {
      kind: "ramp_from_to",
      fromPercent: fromPercentResult.value,
      toPercent: toPercentResult.value,
      fromPercentRange: fromPercentResult.range,
      toPercentRange: toPercentResult.range,
    };
  } else if (branchToken.kind === "identifier" && branchToken.lexeme === "over") {
    cursor.advance();
    rampAst = { kind: "ramp_over_only" };
  } else {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, branchToken),
          rangeText: branchToken.lexeme,
          message: "Expected 'from' or 'over' after 'ramp' in animator declaration.",
        }),
      ]),
    };
  }

  const durationNumberToken = cursor.current();
  if (durationNumberToken.kind !== "number_literal") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, durationNumberToken),
          rangeText: durationNumberToken.lexeme,
          message: "Expected numeric duration before unit token.",
        }),
      ]),
    };
  }
  cursor.advance();

  const durationUnitToken = cursor.current();
  let durationUnit: "ms" | "deg";
  if (durationUnitToken.kind === "ms_keyword") {
    durationUnit = "ms";
  } else if (durationUnitToken.kind === "deg_keyword") {
    durationUnit = "deg";
  } else {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, durationUnitToken),
          rangeText: durationUnitToken.lexeme,
          message: 'Expected duration unit "ms" or "deg" after number.',
        }),
      ]),
    };
  }
  cursor.advance();

  const easeKwToken = cursor.current();
  if (easeKwToken.kind !== "identifier" || easeKwToken.lexeme !== "ease") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, easeKwToken),
          rangeText: easeKwToken.lexeme,
          message: "Expected 'ease' before easing name.",
        }),
      ]),
    };
  }
  cursor.advance();

  const easeNameToken = cursor.current();
  if (easeNameToken.kind !== "identifier") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, easeNameToken),
          rangeText: easeNameToken.lexeme,
          message: "Expected easing name after 'ease'.",
        }),
      ]),
    };
  }
  cursor.advance();

  const durationRange: AstRange = {
    fileName,
    start: durationNumberToken.start,
    end: durationUnitToken.end,
  };

  const declarationRange: AstRange = {
    fileName,
    start: animatorKeywordToken.start,
    end: easeNameToken.end,
  };

  return {
    ok: true,
    declaration: {
      kind: "animator_declaration",
      range: declarationRange,
      animatorName: nameToken.lexeme,
      ramp: rampAst,
      durationValue: Number.parseInt(durationNumberToken.lexeme, 10),
      durationUnit,
      durationRange,
      easeName: easeNameToken.lexeme,
      easeRange: {
        fileName,
        start: easeNameToken.start,
        end: easeNameToken.end,
      },
    },
  };
}

function parseOptionalTaskStateMembership(
  cursor: ParserCursor,
): { ok: true; membership: TaskStateMembershipAst } | { ok: false; report: DiagnosticReport } {
  const t = cursor.current();
  if (t.kind !== "identifier" || t.lexeme !== "in") {
    return { ok: true, membership: { kind: "none" } };
  }
  cursor.advance();
  const pathResult = parseAbsoluteStatePath(cursor);
  if (pathResult.ok === false) {
    return pathResult;
  }
  return {
    ok: true,
    membership: {
      kind: "in_state_path",
      statePathText: pathResult.pathText,
      statePathRange: pathResult.pathRange,
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

  const membershipResult = parseOptionalTaskStateMembership(cursor);
  if (membershipResult.ok === false) {
    return membershipResult;
  }
  const stateMembership = membershipResult.membership;

  const branchToken = cursor.current();
  if (branchToken.kind === "identifier" && branchToken.lexeme === "every") {
    return parseTaskEveryAfterTaskName(cursor, taskKeyword, taskNameToken, stateMembership);
  }
  if (branchToken.kind === "identifier" && branchToken.lexeme === "on") {
    return parseTaskOnAfterTaskName(cursor, taskKeyword, taskNameToken, stateMembership);
  }
  if (branchToken.kind === "identifier" && branchToken.lexeme === "loop") {
    return parseTaskLoopAfterTaskName(cursor, taskKeyword, taskNameToken, stateMembership);
  }

  return {
    ok: false,
    report: createDiagnosticReport([
      buildParseUnexpectedToken({
        file: fileName,
        range: tokenToDiagnosticRange(fileName, branchToken),
        rangeText: branchToken.lexeme,
        message: 'Expected "every", "loop", or "on" after task name.',
      }),
    ]),
  };
}

function parseTaskEveryAfterTaskName(
  cursor: ParserCursor,
  taskKeyword: Token,
  taskNameToken: Token,
  stateMembership: TaskStateMembershipAst,
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
      stateMembership,
      schedule: {
        kind: "every",
        intervalValue: Number.parseInt(numberToken.lexeme, 10),
        intervalUnit,
        intervalRange,
      },
      bodyStatements,
    },
  };
}

function parseTaskLoopAfterTaskName(
  cursor: ParserCursor,
  taskKeyword: Token,
  taskNameToken: Token,
  stateMembership: TaskStateMembershipAst,
): { ok: true; declaration: TaskDeclarationAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const loopKeywordToken = cursor.current();
  cursor.advance();

  const loopKeywordRange: AstRange = {
    fileName,
    start: loopKeywordToken.start,
    end: loopKeywordToken.end,
  };

  const leftBrace = cursor.current();
  if (leftBrace.kind !== "left_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, leftBrace),
          rangeText: leftBrace.lexeme,
          message: "Expected '{' before loop task body.",
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
          message: "Expected '}' after loop task body.",
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
      stateMembership,
      schedule: {
        kind: "loop",
        loopKeywordRange,
      },
      bodyStatements,
    },
  };
}

function parseTaskOnAfterTaskName(
  cursor: ParserCursor,
  taskKeyword: Token,
  taskNameToken: Token,
  stateMembership: TaskStateMembershipAst,
): { ok: true; declaration: TaskOnDeclarationAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  cursor.advance();

  const nextTok = cursor.current();
  if (nextTok.kind === "identifier" && (nextTok.lexeme === "enter" || nextTok.lexeme === "exit")) {
    cursor.advance();
    const lifecycle = nextTok.lexeme === "enter" ? "enter" : "exit";

    const leftBrace = cursor.current();
    if (leftBrace.kind !== "left_brace") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, leftBrace),
            rangeText: leftBrace.lexeme,
            message: "Expected '{' before task on enter/exit body.",
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
            message: "Expected '}' after task on enter/exit body.",
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
        stateMembership,
        trigger: { kind: "state_lifecycle", lifecycle },
        bodyStatements,
      },
    };
  }

  const eventTargetNameToken = nextTok;
  if (eventTargetNameToken.kind !== "identifier") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, eventTargetNameToken),
          rangeText: eventTargetNameToken.lexeme,
          message: "Expected device kind or ref name for task on event.",
        }),
      ]),
    };
  }
  cursor.advance();

  const eventTargetSeparatorToken = cursor.current();
  let eventTarget: TaskOnEventTargetAst;

  if (eventTargetSeparatorToken.kind === "hash") {
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

    eventTarget = {
      kind: "device_event_target",
      range: {
        fileName,
        start: eventTargetNameToken.start,
        end: idToken.end,
      },
      deviceKind: eventTargetNameToken.lexeme,
      deviceId: Number.parseInt(idToken.lexeme, 10),
    };
  } else {
    eventTarget = {
      kind: "ref_event_target",
      range: {
        fileName,
        start: eventTargetNameToken.start,
        end: eventTargetNameToken.end,
      },
      name: eventTargetNameToken.lexeme,
    };
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
      stateMembership,
      trigger: {
        kind: "device_event",
        eventTarget,
        eventName: eventNameToken.lexeme,
      },
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

function parseMatchStatement(
  cursor: ParserCursor,
): { ok: true; statement: MatchStatementAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const matchKeyword = cursor.current();
  cursor.advance();

  const targetResult = parseExpression(cursor);
  if (targetResult.ok === false) {
    return targetResult;
  }

  const openBrace = cursor.current();
  if (openBrace.kind !== "left_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, openBrace),
          rangeText: openBrace.lexeme,
          message: "Expected '{' before match arms.",
        }),
      ]),
    };
  }
  cursor.advance();

  const stringCases: MatchStatementAst["stringCases"] = [];

  while (true) {
    const nextToken = cursor.current();
    if (cursor.isAtEndOfFile()) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, nextToken),
            rangeText: nextToken.lexeme,
            message: "Unexpected end of file inside match body.",
          }),
        ]),
      };
    }

    if (nextToken.kind === "identifier" && nextToken.lexeme === "else") {
      break;
    }

    if (nextToken.kind !== "string_literal") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, nextToken),
            rangeText: nextToken.lexeme,
            message: "Expected a string pattern or 'else' in match body.",
          }),
        ]),
      };
    }

    const patternStringLiteral = nextToken.lexeme;
    cursor.advance();

    const arrowToken = cursor.current();
    if (arrowToken.kind !== "fat_arrow") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, arrowToken),
            rangeText: arrowToken.lexeme,
            message: "Expected '=>' after match pattern.",
          }),
        ]),
      };
    }
    cursor.advance();

    const branchOpen = cursor.current();
    if (branchOpen.kind !== "left_brace") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, branchOpen),
            rangeText: branchOpen.lexeme,
            message: "Expected '{' before match arm body.",
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

    const branchClose = cursor.current();
    if (branchClose.kind !== "right_brace") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, branchClose),
            rangeText: branchClose.lexeme,
            message: "Expected '}' after match arm body.",
          }),
        ]),
      };
    }
    cursor.advance();

    stringCases.push({
      patternStringLiteral,
      bodyStatements,
    });
  }

  const elseKeyword = cursor.current();
  if (elseKeyword.kind !== "identifier" || elseKeyword.lexeme !== "else") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildMatchMissingElseBranch({
          range: tokenToDiagnosticRange(fileName, elseKeyword),
        }),
      ]),
    };
  }
  cursor.advance();

  const elseArrow = cursor.current();
  if (elseArrow.kind !== "fat_arrow") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, elseArrow),
          rangeText: elseArrow.lexeme,
          message: "Expected '=>' after 'else' in match.",
        }),
      ]),
    };
  }
  cursor.advance();

  const elseOpen = cursor.current();
  if (elseOpen.kind !== "left_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, elseOpen),
          rangeText: elseOpen.lexeme,
          message: "Expected '{' before else body.",
        }),
      ]),
    };
  }
  cursor.advance();

  const elseBodyStatements: StatementAst[] = [];
  while (cursor.current().kind !== "right_brace" && !cursor.isAtEndOfFile()) {
    const statementResult = parseStatement(cursor);
    if (statementResult.ok === false) {
      return statementResult;
    }
    elseBodyStatements.push(statementResult.statement);
  }

  const elseClose = cursor.current();
  if (elseClose.kind !== "right_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, elseClose),
          rangeText: elseClose.lexeme,
          message: "Expected '}' after else body.",
        }),
      ]),
    };
  }
  cursor.advance();

  const matchClose = cursor.current();
  if (matchClose.kind !== "right_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, matchClose),
          rangeText: matchClose.lexeme,
          message: "Expected '}' after match statement.",
        }),
      ]),
    };
  }
  cursor.advance();

  const statementRange: AstRange = {
    fileName,
    start: matchKeyword.start,
    end: matchClose.end,
  };

  const matchStatement: MatchStatementAst = {
    kind: "match_statement",
    range: statementRange,
    matchTargetExpression: targetResult.expression,
    stringCases,
    elseBodyStatements,
  };

  return { ok: true, statement: matchStatement };
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

  if (leading.kind === "identifier" && leading.lexeme === "match") {
    return parseMatchStatement(cursor);
  }

  if (leading.kind === "identifier" && leading.lexeme === "temp") {
    return parseTempStatement(cursor);
  }

  if (leading.kind === "identifier" && leading.lexeme === "if") {
    return parseIfStatement(cursor);
  }

  return {
    ok: false,
    report: createDiagnosticReport([
      buildParseUnsupportedSyntax({
        file: fileName,
        range: tokenToDiagnosticRange(fileName, leading),
        rangeText: leading.lexeme,
        message: "Unsupported statement: expected do, set, wait, match, temp, or if.",
      }),
    ]),
  };
}

function parseTempStatement(
  cursor: ParserCursor,
): { ok: true; statement: StatementAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const tempKeyword = cursor.current();
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
          message: "Expected temp variable name after temp.",
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
          message: "Expected '=' in temp statement.",
        }),
      ]),
    };
  }
  cursor.advance();

  const valueResult = parseExpression(cursor);
  if (valueResult.ok === false) {
    return valueResult;
  }

  const statementRange: AstRange = {
    fileName,
    start: tempKeyword.start,
    end: valueResult.expression.range.end,
  };

  return {
    ok: true,
    statement: {
      kind: "temp_statement",
      range: statementRange,
      tempName: nameToken.lexeme,
      valueExpression: valueResult.expression,
    },
  };
}

function parseIfStatement(
  cursor: ParserCursor,
): { ok: true; statement: StatementAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const ifKeyword = cursor.current();
  cursor.advance();

  const conditionResult = parseExpression(cursor);
  if (conditionResult.ok === false) {
    return conditionResult;
  }

  const thenOpen = cursor.current();
  if (thenOpen.kind !== "left_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, thenOpen),
          rangeText: thenOpen.lexeme,
          message: "Expected '{' before if body.",
        }),
      ]),
    };
  }
  cursor.advance();

  const thenBodyStatements: StatementAst[] = [];
  while (cursor.current().kind !== "right_brace" && !cursor.isAtEndOfFile()) {
    const statementResult = parseStatement(cursor);
    if (statementResult.ok === false) {
      return statementResult;
    }
    thenBodyStatements.push(statementResult.statement);
  }

  const thenClose = cursor.current();
  if (thenClose.kind !== "right_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, thenClose),
          rangeText: thenClose.lexeme,
          message: "Expected '}' after if body.",
        }),
      ]),
    };
  }
  cursor.advance();

  let elseBodyStatements: StatementAst[] = [];
  let statementRangeEnd = thenClose.end;

  const maybeElse = cursor.current();
  if (maybeElse.kind === "identifier" && maybeElse.lexeme === "else") {
    cursor.advance();
    const elseOpen = cursor.current();
    if (elseOpen.kind !== "left_brace") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, elseOpen),
            rangeText: elseOpen.lexeme,
            message: "Expected '{' before else body.",
          }),
        ]),
      };
    }
    cursor.advance();

    while (cursor.current().kind !== "right_brace" && !cursor.isAtEndOfFile()) {
      const statementResult = parseStatement(cursor);
      if (statementResult.ok === false) {
        return statementResult;
      }
      elseBodyStatements.push(statementResult.statement);
    }

    const elseClose = cursor.current();
    if (elseClose.kind !== "right_brace") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, elseClose),
            rangeText: elseClose.lexeme,
            message: "Expected '}' after else body.",
          }),
        ]),
      };
    }
    cursor.advance();
    statementRangeEnd = elseClose.end;
  }

  const statementRange: AstRange = {
    fileName,
    start: ifKeyword.start,
    end: statementRangeEnd,
  };

  return {
    ok: true,
    statement: {
      kind: "if_statement",
      range: statementRange,
      conditionExpression: conditionResult.expression,
      thenBodyStatements,
      elseBodyStatements,
    },
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
          message: "Expected var name after set.",
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

  const valueResult = parseExpression(cursor);
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
      varName: nameToken.lexeme,
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

  const durationExpressionResult = parseExpression(cursor);
  if (durationExpressionResult.ok === false) {
    return durationExpressionResult;
  }

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
    start: durationExpressionResult.expression.range.start,
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
      durationMillisecondsExpression: durationExpressionResult.expression,
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
      const argumentResult = parseExpression(cursor);
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

function parseExpression(
  cursor: ParserCursor,
): { ok: true; expression: MethodArgumentExpressionAst } | { ok: false; report: DiagnosticReport } {
  return parseComparisonExpression(cursor);
}

function parseComparisonExpression(
  cursor: ParserCursor,
): { ok: true; expression: MethodArgumentExpressionAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const leftResult = parseAdditiveExpression(cursor);
  if (leftResult.ok === false) {
    return leftResult;
  }

  const comparisonOperator = mapTokenKindToComparisonOperator(cursor.current().kind);
  if (comparisonOperator === undefined) {
    return leftResult;
  }
  cursor.advance();

  const rightResult = parseAdditiveExpression(cursor);
  if (rightResult.ok === false) {
    return rightResult;
  }

  return {
    ok: true,
    expression: {
      kind: "comparison",
      range: {
        fileName,
        start: leftResult.expression.range.start,
        end: rightResult.expression.range.end,
      },
      operator: comparisonOperator,
      left: leftResult.expression,
      right: rightResult.expression,
    },
  };
}

function mapTokenKindToComparisonOperator(
  kind: Token["kind"],
): "==" | "!=" | "<" | "<=" | ">" | ">=" | undefined {
  if (kind === "equals_equals") {
    return "==";
  }
  if (kind === "bang_equals") {
    return "!=";
  }
  if (kind === "less") {
    return "<";
  }
  if (kind === "less_equal") {
    return "<=";
  }
  if (kind === "greater") {
    return ">";
  }
  if (kind === "greater_equal") {
    return ">=";
  }
  return undefined;
}

function parseAdditiveExpression(
  cursor: ParserCursor,
): { ok: true; expression: MethodArgumentExpressionAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const firstMultiplicative = parseMultiplicativeExpression(cursor);
  if (firstMultiplicative.ok === false) {
    return firstMultiplicative;
  }

  let accumulated: MethodArgumentExpressionAst = firstMultiplicative.expression;

  while (cursor.current().kind === "plus" || cursor.current().kind === "minus") {
    const operatorToken = cursor.current();
    const isPlus = operatorToken.kind === "plus";
    cursor.advance();
    const nextMultiplicative = parseMultiplicativeExpression(cursor);
    if (nextMultiplicative.ok === false) {
      return nextMultiplicative;
    }
    accumulated = isPlus
      ? {
          kind: "binary_add",
          range: {
            fileName,
            start: accumulated.range.start,
            end: nextMultiplicative.expression.range.end,
          },
          left: accumulated,
          right: nextMultiplicative.expression,
        }
      : {
          kind: "binary_sub",
          range: {
            fileName,
            start: accumulated.range.start,
            end: nextMultiplicative.expression.range.end,
          },
          left: accumulated,
          right: nextMultiplicative.expression,
        };
  }

  return { ok: true, expression: accumulated };
}

function parseMultiplicativeExpression(
  cursor: ParserCursor,
): { ok: true; expression: MethodArgumentExpressionAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const firstUnary = parseUnaryExpression(cursor);
  if (firstUnary.ok === false) {
    return firstUnary;
  }

  let accumulated: MethodArgumentExpressionAst = firstUnary.expression;

  while (cursor.current().kind === "star" || cursor.current().kind === "slash") {
    const operatorToken = cursor.current();
    const isMultiply = operatorToken.kind === "star";
    cursor.advance();
    const nextUnary = parseUnaryExpression(cursor);
    if (nextUnary.ok === false) {
      return nextUnary;
    }
    accumulated = isMultiply
      ? {
          kind: "binary_mul",
          range: {
            fileName,
            start: accumulated.range.start,
            end: nextUnary.expression.range.end,
          },
          left: accumulated,
          right: nextUnary.expression,
        }
      : {
          kind: "binary_div",
          range: {
            fileName,
            start: accumulated.range.start,
            end: nextUnary.expression.range.end,
          },
          left: accumulated,
          right: nextUnary.expression,
        };
  }

  return { ok: true, expression: accumulated };
}

function parseUnaryExpression(
  cursor: ParserCursor,
): { ok: true; expression: MethodArgumentExpressionAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  if (cursor.current().kind === "minus") {
    const minusToken = cursor.current();
    cursor.advance();
    const operandResult = parseUnaryExpression(cursor);
    if (operandResult.ok === false) {
      return operandResult;
    }
    return {
      ok: true,
      expression: {
        kind: "unary_minus",
        range: {
          fileName,
          start: minusToken.start,
          end: operandResult.expression.range.end,
        },
        operand: operandResult.expression,
      },
    };
  }

  return parsePrimaryExpression(cursor);
}

function parsePrimaryExpression(
  cursor: ParserCursor,
): { ok: true; expression: MethodArgumentExpressionAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const token = cursor.current();

  if (token.kind === "left_paren") {
    const openParen = token;
    cursor.advance();
    const innerResult = parseExpression(cursor);
    if (innerResult.ok === false) {
      return innerResult;
    }
    const closeParen = cursor.current();
    if (closeParen.kind !== "right_paren") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, closeParen),
            rangeText: closeParen.lexeme,
            message: "Expected ')' after parenthesized expression.",
          }),
        ]),
      };
    }
    cursor.advance();
    return innerResult;
  }

  if (token.kind === "number_literal") {
    const numberToken = token;
    cursor.advance();
    if (cursor.current().kind === "percent_sign") {
      const percentToken = cursor.current();
      cursor.advance();
      return {
        ok: true,
        expression: {
          kind: "percent_literal",
          range: { fileName, start: numberToken.start, end: percentToken.end },
          value: Number.parseInt(numberToken.lexeme, 10),
        },
      };
    }
    return {
      ok: true,
      expression: {
        kind: "integer_literal",
        range: { fileName, start: numberToken.start, end: numberToken.end },
        value: Number.parseInt(numberToken.lexeme, 10),
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

  if (token.kind === "identifier" && token.lexeme === "match") {
    return parseMatchExpressionPrimary(cursor);
  }

  if (token.kind === "identifier" && token.lexeme === "step") {
    const stepStart = token.start;
    cursor.advance();
    const animatorNameToken = cursor.current();
    if (animatorNameToken.kind !== "identifier") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, animatorNameToken),
            rangeText: animatorNameToken.lexeme,
            message: "Expected animator name after 'step'.",
          }),
        ]),
      };
    }
    cursor.advance();
    const withToken = cursor.current();
    if (withToken.kind !== "identifier" || withToken.lexeme !== "with") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, withToken),
            rangeText: withToken.lexeme,
            message: "Expected 'with' after animator name in step expression.",
          }),
        ]),
      };
    }
    cursor.advance();
    const afterWithToken = cursor.current();
    if (afterWithToken.kind === "identifier" && afterWithToken.lexeme === "dt") {
      const dtToken = afterWithToken;
      cursor.advance();
      return {
        ok: true,
        expression: {
          kind: "step_animator_expression",
          range: { fileName, start: stepStart, end: dtToken.end },
          animatorName: animatorNameToken.lexeme,
        },
      };
    }

    const targetResult = parseExpression(cursor);
    if (targetResult.ok === false) {
      return targetResult;
    }

    const dtAfterTargetToken = cursor.current();
    if (dtAfterTargetToken.kind !== "identifier" || dtAfterTargetToken.lexeme !== "dt") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, dtAfterTargetToken),
            rangeText: dtAfterTargetToken.lexeme,
            message: "Expected 'dt' after step target expression.",
          }),
        ]),
      };
    }
    cursor.advance();

    return {
      ok: true,
      expression: {
        kind: "step_animator_expression",
        range: { fileName, start: stepStart, end: dtAfterTargetToken.end },
        animatorName: animatorNameToken.lexeme,
        targetExpression: targetResult.expression,
      },
    };
  }

  if (token.kind === "identifier" && token.lexeme === "dt") {
    cursor.advance();
    return {
      ok: true,
      expression: {
        kind: "dt_expression",
        range: { fileName, start: token.start, end: token.end },
      },
    };
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

function parseMatchExpressionPrimary(
  cursor: ParserCursor,
): { ok: true; expression: MethodArgumentExpressionAst } | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const matchKeyword = cursor.current();
  cursor.advance();

  const scrutineeResult = parseExpression(cursor);
  if (scrutineeResult.ok === false) {
    return scrutineeResult;
  }

  const openBrace = cursor.current();
  if (openBrace.kind !== "left_brace") {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnexpectedToken({
          file: fileName,
          range: tokenToDiagnosticRange(fileName, openBrace),
          rangeText: openBrace.lexeme,
          message: "Expected '{' after match scrutinee expression.",
        }),
      ]),
    };
  }
  cursor.advance();

  const arms: MatchExpressionArmAst[] = [];
  let elseResultExpression: MethodArgumentExpressionAst | undefined;

  while (cursor.current().kind !== "right_brace" && !cursor.isAtEndOfFile()) {
    const nextTok = cursor.current();
    if (nextTok.kind === "identifier" && nextTok.lexeme === "else") {
      cursor.advance();
      const elseArrow = cursor.current();
      if (elseArrow.kind !== "fat_arrow") {
        return {
          ok: false,
          report: createDiagnosticReport([
            buildParseUnexpectedToken({
              file: fileName,
              range: tokenToDiagnosticRange(fileName, elseArrow),
              rangeText: elseArrow.lexeme,
              message: "Expected '=>' after else in match expression.",
            }),
          ]),
        };
      }
      cursor.advance();
      const elseExprResult = parseExpression(cursor);
      if (elseExprResult.ok === false) {
        return elseExprResult;
      }
      elseResultExpression = elseExprResult.expression;
      const maybeComma = cursor.current();
      if (maybeComma.kind === "comma") {
        cursor.advance();
      }
      break;
    }

    const patternResult = parseMatchNumericPattern(cursor);
    if (patternResult.ok === false) {
      return patternResult;
    }

    const arrowToken = cursor.current();
    if (arrowToken.kind !== "fat_arrow") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, arrowToken),
            rangeText: arrowToken.lexeme,
            message: "Expected '=>' after match pattern.",
          }),
        ]),
      };
    }
    cursor.advance();

    const resultResult = parseExpression(cursor);
    if (resultResult.ok === false) {
      return resultResult;
    }

    arms.push({
      range: patternResult.pattern.range,
      pattern: patternResult.pattern,
      resultExpression: resultResult.expression,
    });

    const separator = cursor.current();
    if (separator.kind === "comma") {
      cursor.advance();
    }
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
          message: "Expected '}' to close match expression.",
        }),
      ]),
    };
  }
  cursor.advance();

  return {
    ok: true,
    expression: {
      kind: "match_expression",
      range: {
        fileName,
        start: matchKeyword.start,
        end: closeBrace.end,
      },
      scrutinee: scrutineeResult.expression,
      arms,
      elseResultExpression,
    },
  };
}

function parseMatchNumericPattern(
  cursor: ParserCursor,
):
  | { ok: true; pattern: MatchNumericPatternAst }
  | { ok: false; report: DiagnosticReport } {
  const fileName = cursor.getSourceFileName();
  const patternStartToken = cursor.current();

  if (patternStartToken.kind === "dot_dot") {
    const rangeStart = patternStartToken.start;
    cursor.advance();
    const afterDots = cursor.current();
    if (afterDots.kind === "fat_arrow") {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnexpectedToken({
            file: fileName,
            range: tokenToDiagnosticRange(fileName, afterDots),
            rangeText: afterDots.lexeme,
            message: "Expected range bound after '..'.",
          }),
        ]),
      };
    }
    const endResult = parseAdditiveExpression(cursor);
    if (endResult.ok === false) {
      return endResult;
    }
    return {
      ok: true,
      pattern: {
        kind: "range_pattern",
        range: {
          fileName,
          start: patternStartToken.start,
          end: endResult.expression.range.end,
        },
        endExclusive: endResult.expression,
      },
    };
  }

  const firstBound = parseAdditiveExpression(cursor);
  if (firstBound.ok === false) {
    return firstBound;
  }

  if (cursor.current().kind === "dot_dot") {
    cursor.advance();
    const afterRangeDots = cursor.current();
    if (afterRangeDots.kind === "fat_arrow") {
      return {
        ok: true,
        pattern: {
          kind: "range_pattern",
          range: {
            fileName,
            start: patternStartToken.start,
            end: firstBound.expression.range.end,
          },
          startInclusive: firstBound.expression,
        },
      };
    }
    const endBound = parseAdditiveExpression(cursor);
    if (endBound.ok === false) {
      return endBound;
    }
    return {
      ok: true,
      pattern: {
        kind: "range_pattern",
        range: {
          fileName,
          start: patternStartToken.start,
          end: endBound.expression.range.end,
        },
        startInclusive: firstBound.expression,
        endExclusive: endBound.expression,
      },
    };
  }

  return {
    ok: true,
    pattern: {
      kind: "equality_pattern",
      range: firstBound.expression.range,
      compareExpression: firstBound.expression,
    },
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
