import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";

describe("circle state animation", () => {
  it("advances circle_x state each tick interval", () => {
    const sourceText = `var circle_x = 20

task move_circle every 100ms {
  do display#0.clear()
  do display#0.circle(circle_x, 32, 8)
  do display#0.present()
  set circle_x = circle_x + 4
}
`;
    const compileResult = compileScript(sourceText, "circle.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const taskRegistry = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks: taskRegistry });
    runtime.replaceCompiledProgram(compileResult.program);

    expect(runtime.getScriptVarValues().get("circle_x")).toBe(20);

    runtime.tick(100);
    expect(runtime.getScriptVarValues().get("circle_x")).toBe(24);

    runtime.tick(100);
    expect(runtime.getScriptVarValues().get("circle_x")).toBe(28);
  });
});
