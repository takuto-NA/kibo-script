import { describe, expect, it } from "vitest";
import { TaskRegistry } from "../../src/core/task-registry";
import { SimulationRuntime } from "../../src/core/simulation-runtime";

describe("SimulationRuntime", () => {
  it("applies serial.println on tick", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    runtime.queueEffect({
      kind: "serial.println",
      address: { kind: "serial", id: 0 },
      text: "ready",
    });
    const result = runtime.tick(0);
    expect(result.appliedEffectCount).toBe(1);
    const out = runtime.getDefaultDevices().serial0.takeOutputLines();
    expect(out).toEqual(["ready"]);
  });

  it("reads adc#0", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const v = runtime.getDeviceBus().read({
      address: { kind: "adc", id: 0 },
      property: "",
    });
    expect(v?.tag).toBe("integer");
  });
});
