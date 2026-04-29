import { describe, expect, it } from "vitest";
import { compileInteractiveEveryTaskBodyToExecutableStatements } from "../../src/interactive/compile-interactive-task-body";

describe("compileInteractiveEveryTaskBodyToExecutableStatements", () => {
  it("maps LED toggle line", () => {
    const result = compileInteractiveEveryTaskBodyToExecutableStatements("do led#0.toggle()");
    expect(result.ok).toBe(true);
    if (result.ok === false) {
      return;
    }
    expect(result.executableStatements).toHaveLength(1);
    const statement = result.executableStatements[0];
    expect(statement?.kind).toBe("do_method_call");
    if (statement?.kind === "do_method_call") {
      expect(statement.deviceAddress).toEqual({ kind: "led", id: 0 });
      expect(statement.methodName).toBe("toggle");
    }
  });

  it("rejects unsupported statements such as read", () => {
    const result = compileInteractiveEveryTaskBodyToExecutableStatements("read adc#0");
    expect(result.ok).toBe(false);
  });
});
