import { describe, expect, it } from "vitest";
import { TaskRegistry } from "../../src/core/task-registry";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { evaluateInteractiveCommand } from "../../src/interactive/evaluate-interactive-command";

describe("evaluateInteractiveCommand", () => {
  it("evaluates read adc#0", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const result = evaluateInteractiveCommand(runtime, {
      kind: "read",
      target: "adc#0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines[0]).toMatch(/adc#0 =/);
    }
  });

  it("rejects out of range pixel", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const result = evaluateInteractiveCommand(runtime, {
      kind: "do_display_pixel",
      x: 999,
      y: 0,
    });
    expect(result.ok).toBe(false);
  });
});
