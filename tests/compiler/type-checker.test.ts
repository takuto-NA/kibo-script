import { describe, expect, it } from "vitest";
import { lexSourceText } from "../../src/compiler/lexer";
import { parseProgram } from "../../src/compiler/parser";
import { bindProgram } from "../../src/compiler/binder";
import { typeCheckBoundProgram } from "../../src/compiler/type-checker";

describe("typeCheckBoundProgram", () => {
  it("rejects non-ms task interval unit", () => {
    const sourceText = `ref led = led#0

task blink every 1000deg {
  do led.toggle()
}
`;
    const lexResult = lexSourceText(sourceText, "bad-unit.sc");
    expect(lexResult.ok).toBe(true);
    if (lexResult.ok === false) {
      return;
    }
    const parseResult = parseProgram(lexResult.tokens, "bad-unit.sc");
    expect(parseResult.ok).toBe(true);
    if (parseResult.ok === false) {
      return;
    }
    const bindResult = bindProgram(parseResult.ast, "bad-unit.sc");
    expect(bindResult.ok).toBe(true);
    if (bindResult.ok === false) {
      return;
    }
    const typeReport = typeCheckBoundProgram(bindResult.boundProgram);
    expect(typeReport.diagnostics[0]?.id).toBe("unit.type_mismatch");
    expect(typeReport.diagnostics[0]?.expected).toEqual({ kind: "unit", unit: "ms" });
    expect(typeReport.diagnostics[0]?.actual).toEqual({ kind: "unit", unit: "deg" });
  });

  it("rejects serial.println with integer argument", () => {
    const sourceText = `ref port = serial#0

task print every 1000ms {
  do port.println(123)
}
`;
    const lexResult = lexSourceText(sourceText, "println.sc");
    expect(lexResult.ok).toBe(true);
    if (lexResult.ok === false) {
      return;
    }
    const parseResult = parseProgram(lexResult.tokens, "println.sc");
    expect(parseResult.ok).toBe(true);
    if (parseResult.ok === false) {
      return;
    }
    const bindResult = bindProgram(parseResult.ast, "println.sc");
    expect(bindResult.ok).toBe(true);
    if (bindResult.ok === false) {
      return;
    }
    const typeReport = typeCheckBoundProgram(bindResult.boundProgram);
    expect(typeReport.diagnostics[0]?.id).toBe("type.argument_type_mismatch");
  });

  it("rejects led.toggle with extra arguments", () => {
    const sourceText = `ref led = led#0

task blink every 1000ms {
  do led.toggle(1)
}
`;
    const lexResult = lexSourceText(sourceText, "arity.sc");
    expect(lexResult.ok).toBe(true);
    if (lexResult.ok === false) {
      return;
    }
    const parseResult = parseProgram(lexResult.tokens, "arity.sc");
    expect(parseResult.ok).toBe(true);
    if (parseResult.ok === false) {
      return;
    }
    const bindResult = bindProgram(parseResult.ast, "arity.sc");
    expect(bindResult.ok).toBe(true);
    if (bindResult.ok === false) {
      return;
    }
    const typeReport = typeCheckBoundProgram(bindResult.boundProgram);
    expect(typeReport.diagnostics[0]?.id).toBe("type.method_arity_mismatch");
  });
});
