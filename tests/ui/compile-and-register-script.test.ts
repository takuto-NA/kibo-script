import { describe, expect, it } from "vitest";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";
import { compileSourceAndRegisterSimulationTasks } from "../../src/core/compile-and-register-simulation-script";

describe("compileSourceAndRegisterSimulationTasks", () => {
  it("registers compiled blink task", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const sourceText = `ref led = led#0

task blink every 1000ms {
  do led.toggle()
}
`;
    const result = compileSourceAndRegisterSimulationTasks({
      sourceText,
      sourceFileName: "blink.sc",
      simulationRuntime: runtime,
    });
    expect(result.ok).toBe(true);
    if (result.ok === false) {
      return;
    }
    expect(result.registeredTaskNames).toEqual(["blink"]);
    expect(runtime.tasks.getTask("blink")?.compiledStatements?.length).toBeGreaterThan(0);
  });

  it("returns diagnostics for invalid unit interval", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const sourceText = `ref led = led#0

task blink every 1000deg {
  do led.toggle()
}
`;
    const result = compileSourceAndRegisterSimulationTasks({
      sourceText,
      sourceFileName: "bad.sc",
      simulationRuntime: runtime,
    });
    expect(result.ok).toBe(false);
    if (result.ok === true) {
      return;
    }
    expect(result.report.diagnostics[0]?.id).toBe("unit.type_mismatch");
  });

  it("add mode compiles against ambient refs and registers additional tasks", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const baseLoad = compileSourceAndRegisterSimulationTasks({
      sourceText: `ref led = led#0
`,
      sourceFileName: "ambient.sc",
      simulationRuntime: runtime,
      registrationMode: "reset",
    });
    expect(baseLoad.ok).toBe(true);

    const additiveLoad = compileSourceAndRegisterSimulationTasks({
      sourceText: `task blink every 1000ms {
  do led.toggle()
}
`,
      sourceFileName: "follow.sc",
      simulationRuntime: runtime,
      registrationMode: "add",
    });
    expect(additiveLoad.ok).toBe(true);
    if (additiveLoad.ok === false) {
      return;
    }
    expect(additiveLoad.registeredTaskNames).toEqual(["blink"]);
    expect(runtime.tasks.getTask("blink")).toBeDefined();
  });
});
