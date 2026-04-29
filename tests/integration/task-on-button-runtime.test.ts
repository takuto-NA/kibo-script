import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";

describe("task on button event", () => {
  it("runs compiled body when dispatchScriptEvent matches filter", () => {
    const sourceText = `task pulse on button#0.pressed {
  do led#0.on()
}
`;
    const compileResult = compileScript(sourceText, "on.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const runtime = new SimulationRuntime({ tasks: new TaskRegistry() });
    runtime.replaceCompiledProgram(compileResult.program);
    const led = runtime.getDefaultDevices().led0;

    expect(led.isOn()).toBe(false);

    runtime.dispatchScriptEvent({
      deviceAddress: { kind: "button", id: 0 },
      eventName: "pressed",
    });

    expect(led.isOn()).toBe(true);
  });

  it("resolves ref receiver in task on event filter", () => {
    const sourceText = `ref led = led#0
ref button = button#0

task react on button.pressed {
  do led.toggle()
}
`;
    const compileResult = compileScript(sourceText, "on-ref.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const runtime = new SimulationRuntime({ tasks: new TaskRegistry() });
    runtime.replaceCompiledProgram(compileResult.program);
    const led = runtime.getDefaultDevices().led0;

    expect(led.isOn()).toBe(false);

    runtime.dispatchScriptEvent({
      deviceAddress: { kind: "button", id: 0 },
      eventName: "pressed",
    });

    expect(led.isOn()).toBe(true);
  });
});
