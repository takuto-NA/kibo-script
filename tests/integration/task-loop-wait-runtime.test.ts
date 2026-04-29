import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";

describe("task loop + wait expression runtime", () => {
  it("loops a task body and resumes after wait using an integer expression", () => {
    const sourceText = `ref led = led#0

const on_ms = 50
const off_ms = 50

task blink loop {
  do led.on()
  wait on_ms ms
  do led.off()
  wait off_ms ms
}
`;
    const compileResult = compileScript(sourceText, "loop-wait.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const runtime = new SimulationRuntime({ tasks: new TaskRegistry() });
    runtime.replaceCompiledProgram(compileResult.program);
    const led = runtime.getDefaultDevices().led0;

    expect(led.isOn()).toBe(true);

    runtime.tick(41);
    expect(led.isOn()).toBe(true);

    runtime.tick(19);
    expect(led.isOn()).toBe(false);

    runtime.tick(61);
    expect(led.isOn()).toBe(true);

    runtime.tick(39);
    expect(led.isOn()).toBe(true);

    runtime.tick(12);
    expect(led.isOn()).toBe(false);

    runtime.tick(39);
    expect(led.isOn()).toBe(false);

    runtime.tick(12);
    expect(led.isOn()).toBe(true);
  });
});
