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

  it("returns adc and led fields in getSnapshot", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const embed = new EmbedController(runtime);
    const result = embed.handleMessage({
      source: "kibo-simulator-parent",
      type: "simulator.getSnapshot",
      requestId: "rSnap",
    });
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.outputs[0]).toMatch(/adc0.raw=/);
      expect(result.outputs[1]).toMatch(/led0.on=/);
      expect(result.outputs[2]).toMatch(/pwm0.level=/);
      expect(result.outputs[3]).toMatch(/button0.pressed=/);
      expect(result.outputs[4]).toMatch(/motor0.power=/);
      expect(result.outputs[5]).toMatch(/motor1.power=/);
      expect(result.outputs[6]).toMatch(/servo0.angle=/);
      expect(result.outputs[7]).toMatch(/imu0.roll_mdeg=/);
      expect(result.outputs[8]).toMatch(/imu0.pitch_mdeg=/);
      expect(result.outputs[9]).toMatch(/imu0.yaw_mdeg=/);
    }
  });

  it("loads script from embed message", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const embed = new EmbedController(runtime);
    const sourceText = `ref led = led#0

task blink every 1000ms {
  do led.toggle()
}
`;
    const result = embed.handleMessage({
      source: "kibo-simulator-parent",
      type: "simulator.loadScript",
      requestId: "rLoad",
      sourceText,
      sourceFileName: "embed.sc",
    });
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.outputs[0]).toContain("registeredTasks=blink");
    }
    expect(runtime.tasks.getTask("blink")?.compiledStatements?.length).toBeGreaterThan(0);
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
