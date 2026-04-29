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
      ledId: 0,
      ledEffect: "toggle",
    });
    expect(toggleOn.ok).toBe(true);
    expect(ledDevice.isOn()).toBe(true);

    const toggleOff = evaluateInteractiveCommand(runtime, {
      kind: "do_led_effect",
      ledId: 0,
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
});
