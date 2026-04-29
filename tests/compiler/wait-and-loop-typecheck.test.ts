import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";

describe("wait expression + loop task type/semantic checks", () => {
  it("rejects string wait duration at type-check time", () => {
    const sourceText = `task t every 10ms {
  wait "nope" ms
}
`;
    const result = compileScript(sourceText, "wait-string.sc");
    expect(result.ok).toBe(false);
    if (result.ok === true) {
      return;
    }
    expect(result.report.diagnostics.some((d) => d.message.includes("wait duration must be an integer"))).toBe(
      true,
    );
  });

  it("rejects loop tasks with no wait statements", () => {
    const sourceText = `task spin loop {
  do led#0.on()
}
`;
    const result = compileScript(sourceText, "loop-no-wait.sc");
    expect(result.ok).toBe(false);
    if (result.ok === true) {
      return;
    }
    expect(result.report.diagnostics.some((d) => d.id === "semantic.loop_task_requires_wait")).toBe(true);
  });

  it("rejects dt usage inside loop tasks", () => {
    const sourceText = `animator a = ramp over 10ms ease linear

task bad loop {
  temp x = dt
  wait 1 ms
}
`;
    const result = compileScript(sourceText, "loop-dt.sc");
    expect(result.ok).toBe(false);
    if (result.ok === true) {
      return;
    }
    expect(result.report.diagnostics.some((d) => d.id === "type.animator_time_expression_invalid_context")).toBe(
      true,
    );
  });
});
