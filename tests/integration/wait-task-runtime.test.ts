import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";

describe("wait in compiled task body", () => {
  it("delays statements across ticks using wait", () => {
    const sourceText = `ref led = led#0

task pulse every 2000ms {
  do led.on()
  wait 100ms
  do led.off()
}
`;
    const compileResult = compileScript(sourceText, "wait.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const runtime = new SimulationRuntime({ tasks: new TaskRegistry() });
    runtime.replaceCompiledProgram(compileResult.program);
    const led = runtime.getDefaultDevices().led0;

    expect(led.isOn()).toBe(false);

    runtime.tick(2000);
    expect(led.isOn()).toBe(true);

    runtime.tick(100);
    expect(led.isOn()).toBe(false);
  });
});
