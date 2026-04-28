import { describe, expect, it } from "vitest";
import { lexSourceText } from "../../src/compiler/lexer";
import { parseProgram } from "../../src/compiler/parser";

describe("parseProgram", () => {
  it("parses ref and task with do led.toggle()", () => {
    const sourceText = `ref led = led#0

task blink every 1000ms {
  do led.toggle()
}
`;
    const lexResult = lexSourceText(sourceText, "blink.sc");
    expect(lexResult.ok).toBe(true);
    if (lexResult.ok === false) {
      return;
    }
    const parseResult = parseProgram(lexResult.tokens, "blink.sc");
    expect(parseResult.ok).toBe(true);
    if (parseResult.ok === false) {
      return;
    }
    expect(parseResult.ast.declarations).toHaveLength(2);
    const taskDeclaration = parseResult.ast.declarations[1];
    expect(taskDeclaration?.kind).toBe("task_declaration");
    if (taskDeclaration?.kind !== "task_declaration") {
      return;
    }
    expect(taskDeclaration.taskName).toBe("blink");
    expect(taskDeclaration.intervalUnit).toBe("ms");
    expect(taskDeclaration.bodyStatements).toHaveLength(1);
    const firstStatement = taskDeclaration.bodyStatements[0];
    expect(firstStatement?.kind).toBe("do_statement");
    if (firstStatement?.kind !== "do_statement") {
      return;
    }
    expect(firstStatement.callExpression.receiver.name).toBe("led");
    expect(firstStatement.callExpression.methodName).toBe("toggle");
    expect(firstStatement.callExpression.arguments).toHaveLength(0);
  });
});
