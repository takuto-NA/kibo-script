import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";

describe("compileScript", () => {
  it("returns compiler.empty_script for whitespace-only source", () => {
    const result = compileScript("   \n\t  \n", "empty.sc");
    expect(result.ok).toBe(false);
    if (result.ok === true) {
      return;
    }
    expect(result.report.diagnostics[0]?.id).toBe("compiler.empty_script");
  });

  it("returns compiler.empty_script when there are no declarations", () => {
    const result = compileScript("// only comment\n", "comments-only.sc");
    expect(result.ok).toBe(false);
    if (result.ok === true) {
      return;
    }
    expect(result.report.diagnostics[0]?.id).toBe("compiler.empty_script");
  });

  it("returns name.unknown_reference when receiver symbol is undefined", () => {
    const sourceText = `
task blink every 1000ms {
  do missing.toggle()
}
`;
    const result = compileScript(sourceText, "unknown-ref.sc");
    expect(result.ok).toBe(false);
    if (result.ok === true) {
      return;
    }
    const diagnostic = result.report.diagnostics[0];
    expect(diagnostic?.id).toBe("name.unknown_reference");
    expect(diagnostic?.phase).toBe("bind");
  });

  it("returns semantic.duplicate_task_name when two tasks share a name", () => {
    const sourceText = `ref led = led#0

task blink every 1000ms {
  do led.toggle()
}
task blink every 2000ms {
  do led.toggle()
}
`;
    const result = compileScript(sourceText, "dup-task.sc");
    expect(result.ok).toBe(false);
    if (result.ok === true) {
      return;
    }
    expect(result.report.diagnostics[0]?.id).toBe("semantic.duplicate_task_name");
  });
});
