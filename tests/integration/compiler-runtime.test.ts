import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { registerCompiledProgramOnTaskRegistry } from "../../src/core/register-compiled-program";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";

describe("compiler runtime integration", () => {
  it("runs compiled blink task on SimulationRuntime tick boundaries", () => {
    const sourceText = `ref led = led#0

task blink every 1000ms {
  do led.toggle()
}
`;
    const compileResult = compileScript(sourceText, "blink.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const taskRegistry = new TaskRegistry();
    registerCompiledProgramOnTaskRegistry({
      taskRegistry,
      compiledProgram: compileResult.program,
    });
    const simulationRuntime = new SimulationRuntime({ tasks: taskRegistry });
    const ledDevice = simulationRuntime.getDefaultDevices().led0;

    expect(ledDevice.isOn()).toBe(false);

    simulationRuntime.tick(999);
    expect(ledDevice.isOn()).toBe(false);

    simulationRuntime.tick(1);
    expect(ledDevice.isOn()).toBe(true);

    simulationRuntime.tick(1000);
    expect(ledDevice.isOn()).toBe(false);
  });
});
