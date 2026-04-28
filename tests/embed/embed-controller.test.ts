import { describe, expect, it } from "vitest";
import { TaskRegistry } from "../../src/core/task-registry";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { EmbedController } from "../../src/embed/embed-controller";

describe("EmbedController", () => {
  it("handles simulator.command", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const embed = new EmbedController(runtime);
    const result = embed.handleMessage({
      source: "kibo-simulator-parent",
      type: "simulator.command",
      requestId: "r1",
      commandLine: "read adc#0",
    });
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.outputs[0]).toMatch(/adc#0 =/);
    }
  });

  it("sets adc value", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const embed = new EmbedController(runtime);
    const result = embed.handleMessage({
      source: "kibo-simulator-parent",
      type: "simulator.setAdcValue",
      requestId: "r2",
      raw: 999,
    });
    expect(result?.ok).toBe(true);
    expect(runtime.getDefaultDevices().adc0.getSimulatedRawValue()).toBe(999);
  });
});
