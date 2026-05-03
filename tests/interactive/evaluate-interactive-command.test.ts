import { describe, expect, it } from "vitest";
import { TaskRegistry } from "../../src/core/task-registry";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { compileSourceAndRegisterSimulationTasks } from "../../src/core/compile-and-register-simulation-script";
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

  it("formats info strings as multiline text", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const result = evaluateInteractiveCommand(runtime, {
      kind: "property_read",
      target: "adc#0",
      property: "info",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines[0]).toContain("kind: adc\nid: 0");
      expect(result.lines[0]).not.toContain("\\n");
      expect(result.lines[0]).not.toContain('"kind: adc');
    }
  });

  it("toggles led#0 via do_led_effect", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const ledDevice = runtime.getDefaultDevices().led0;
    expect(ledDevice.isOn()).toBe(false);

    const toggleOn = evaluateInteractiveCommand(runtime, {
      kind: "do_led_effect",
      ledTargetText: "led#0",
      ledEffect: "toggle",
    });
    expect(toggleOn.ok).toBe(true);
    expect(ledDevice.isOn()).toBe(true);

    const toggleOff = evaluateInteractiveCommand(runtime, {
      kind: "do_led_effect",
      ledTargetText: "led#0",
      ledEffect: "toggle",
    });
    expect(toggleOff.ok).toBe(true);
    expect(ledDevice.isOn()).toBe(false);
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

  it("resolves led.info via registered ref alias", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    compileSourceAndRegisterSimulationTasks({
      sourceText: `ref led = led#0
task t every 1000ms { do led.toggle() }
`,
      sourceFileName: "setup.sc",
      simulationRuntime: runtime,
      registrationMode: "reset",
    });

    const infoResult = evaluateInteractiveCommand(runtime, {
      kind: "property_read",
      target: "led.info",
      property: "info",
    });
    expect(infoResult.ok).toBe(true);
    if (infoResult.ok) {
      expect(infoResult.lines[0]).toContain("kind: led");
    }
  });

  it("lists refs vars states aligned with runtime world", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    compileSourceAndRegisterSimulationTasks({
      sourceText: `state sm every 1000ms initial sm.A {
  A {}
}
var command = 0
ref led = led#0
task ping every 500ms { set command = 1 }
`,
      sourceFileName: "world.sc",
      simulationRuntime: runtime,
      registrationMode: "reset",
    });

    const refs = evaluateInteractiveCommand(runtime, { kind: "list_refs" });
    expect(refs.ok).toBe(true);
    if (refs.ok) {
      expect(refs.lines.some((line) => line.includes("led -> led#0"))).toBe(true);
    }

    const vars = evaluateInteractiveCommand(runtime, { kind: "list_vars" });
    expect(vars.ok).toBe(true);
    if (vars.ok) {
      expect(vars.lines.some((line) => line.includes("command"))).toBe(true);
    }

    const states = evaluateInteractiveCommand(runtime, { kind: "list_states" });
    expect(states.ok).toBe(true);
    if (states.ok) {
      expect(states.lines.some((line) => line.includes("sm"))).toBe(true);
    }
  });
});
