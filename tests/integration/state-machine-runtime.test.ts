/**
 * 状態機械 tick・遷移・on enter と SimulationRuntime の結合テスト。
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScript } from "../../src/compiler/compile-script";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";

const testsIntegrationDirectory = dirname(fileURLToPath(import.meta.url));
const testsDirectory = dirname(testsIntegrationDirectory);

describe("state machine runtime integration", () => {
  it("fires on enter after leaf transition on state machine tick", () => {
    const sourceText = `var flag = 0

state sm every 100ms initial sm.A {
  A {
    on 1 -> sm.B
  }
  B {}
}

task mark in sm.B on enter {
  set flag = 1
}
`;
    const compileResult = compileScript(sourceText, "sm-enter.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const taskRegistry = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks: taskRegistry });
    runtime.replaceCompiledProgram(compileResult.program);

    expect(runtime.getScriptVarValues().get("flag")).toBe(0);

    runtime.tick(100);

    expect(runtime.getScriptVarValues().get("flag")).toBe(1);
  });

  it("uses elapsed for transitions and gates every tasks by active state membership", () => {
    const sourceText = `var active_count = 0
var entered_b = 0

state sm every 100ms initial sm.A {
  A {
    on sm.A.elapsed >= 200 -> sm.B
  }
  B {}
}

task count_a in sm.A every 100ms {
  set active_count = active_count + 1
}

task mark_b in sm.B on enter {
  set entered_b = 1
}
`;
    const compileResult = compileScript(sourceText, "sm-elapsed-membership.sc");
    expect(
      compileResult.ok,
      compileResult.ok === false ? JSON.stringify(compileResult.report.diagnostics, null, 2) : "",
    ).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const taskRegistry = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks: taskRegistry });
    runtime.replaceCompiledProgram(compileResult.program);

    runtime.tick(100);
    expect(runtime.getScriptVarValues().get("active_count")).toBe(1);
    expect(runtime.getScriptVarValues().get("entered_b")).toBe(0);

    runtime.tick(100);
    expect(runtime.getScriptVarValues().get("active_count")).toBe(1);
    expect(runtime.getScriptVarValues().get("entered_b")).toBe(1);
  });

  it("compiles and runs the rover state machine sample script", () => {
    const fixturePath = join(testsDirectory, "compiler", "fixtures", "state-machine-rover.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const compileResult = compileScript(sourceText, "state-machine-rover.sc");
    expect(
      compileResult.ok,
      compileResult.ok === false ? JSON.stringify(compileResult.report.diagnostics, null, 2) : "",
    ).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const taskRegistry = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks: taskRegistry });
    runtime.replaceCompiledProgram(compileResult.program);

    expect(runtime.getScriptVarValues().get("idle_entries")).toBe(1);
    expect(runtime.getScriptVarValues().get("manual_ticks")).toBe(0);
    expect(runtime.getScriptVarValues().get("avoid_entries")).toBe(0);

    runtime.tick(100);
    runtime.tick(100);
    runtime.tick(100);

    expect(runtime.getScriptVarValues().get("manual_ticks")).toBe(3);
    expect(runtime.getScriptVarValues().get("avoid_entries")).toBe(0);

    runtime.tick(100);

    expect(runtime.getScriptVarValues().get("manual_ticks")).toBe(3);
    expect(runtime.getScriptVarValues().get("avoid_entries")).toBe(1);

    runtime.tick(200);

    expect(runtime.getScriptVarValues().get("idle_entries")).toBe(2);
  });
});
