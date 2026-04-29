import { describe, expect, it } from "vitest";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";
import { TerminalSession } from "../../src/interactive/terminal-session";

/**
 * End-to-end smoke script for the browser simulator command surface.
 * Covers ADC read/info (multiline), display draw, LED toggle, diagnostics, and task registration.
 */
describe("smoke script", () => {
  it("reads adc, draws to display, reports diagnostics, and registers a task", () => {
    const runtime = new SimulationRuntime({ tasks: new TaskRegistry() });
    const session = new TerminalSession(runtime);

    const readEntry = session.submitLine("read adc#0");
    expect(readEntry.outputs).toEqual(["adc#0 = 512"]);

    const adcInfoEntry = session.submitLine("adc#0.info");
    expect(adcInfoEntry.outputs[0]).toContain("kind: adc");
    expect(adcInfoEntry.outputs[0]).toContain("\n");
    expect(adcInfoEntry.outputs[0]).not.toContain("\\n");

    const displayInfoEntry = session.submitLine("display#0.info");
    expect(displayInfoEntry.outputs[0]).toContain("size: 128x64");

    session.submitLine("do display#0.clear()");
    session.submitLine("do display#0.line(0, 0, 127, 63)");
    session.submitLine("do display#0.circle(64, 32, 8)");
    session.submitLine("do display#0.present()");

    const presentedFrame = runtime
      .getDefaultDevices()
      .display0.getPresentedFrameBytes();
    const enabledPixelCount = presentedFrame.reduce(
      (count, pixel) => count + (pixel === 1 ? 1 : 0),
      0,
    );
    expect(enabledPixelCount).toBeGreaterThan(40);

    const ledInfoEntry = session.submitLine("led#0.info");
    expect(ledInfoEntry.outputs[0]).toContain("kind: led");

    session.submitLine("do led#0.toggle()");
    expect(runtime.getDefaultDevices().led0.isOn()).toBe(true);

    const invalidPixelEntry = session.submitLine("do display#0.pixel(999, 0)");
    expect(invalidPixelEntry.diagnosticReport?.diagnostics[0]?.id).toBe(
      "runtime.out_of_range",
    );

    const taskEntry = session.submitLine("task blink every 100ms { do display#0.pixel(1, 1) }");
    expect(taskEntry.outputs).toEqual(["registered task blink"]);

    const listTasksEntry = session.submitLine("list tasks");
    expect(listTasksEntry.outputs[0]).toContain("blink");
    expect(listTasksEntry.outputs[0]).toContain("running");
    expect(listTasksEntry.outputs[0]).toContain("every 100ms");
  });
});
