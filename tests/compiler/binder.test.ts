import { describe, expect, it } from "vitest";
import { lexSourceText } from "../../src/compiler/lexer";
import { parseProgram } from "../../src/compiler/parser";
import { bindProgram } from "../../src/compiler/binder";

describe("bindProgram", () => {
  it("resolves do led.toggle() to led#0", () => {
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
    const bindResult = bindProgram(parseResult.ast, "blink.sc");
    expect(bindResult.ok).toBe(true);
    if (bindResult.ok === false) {
      return;
    }
    const firstStatement = bindResult.boundProgram.everyTasks[0]?.statements[0];
    expect(firstStatement?.kind).toBe("do_statement");
    if (firstStatement?.kind !== "do_statement") {
      return;
    }
    expect(firstStatement.deviceAddress).toEqual({ kind: "led", id: 0 });
    expect(firstStatement.methodName).toBe("toggle");
  });
});
