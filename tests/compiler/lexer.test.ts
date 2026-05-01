import { describe, expect, it } from "vitest";
import { lexSourceText } from "../../src/compiler/lexer";

describe("lexSourceText", () => {
  it("tokenizes LED blink script including ms keyword", () => {
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
    const kinds = lexResult.tokens.map((token) => token.kind);
    expect(kinds).toContain("ms_keyword");
    expect(kinds).toContain("hash");
    expect(kinds).toContain("number_literal");
  });

  it("tokenizes thin arrow as a single token so expressions may end before ->", () => {
    const lexResult = lexSourceText("on 1 -> sm.A", "arrow.sc");
    expect(lexResult.ok).toBe(true);
    if (lexResult.ok === false) {
      return;
    }
    const kinds = lexResult.tokens.map((token) => token.kind);
    expect(kinds).toContain("thin_arrow");
  });
});
