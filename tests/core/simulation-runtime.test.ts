import { describe, expect, it } from "vitest";
import { TaskRegistry } from "../../src/core/task-registry";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { compileSourceAndRegisterSimulationTasks } from "../../src/core/compile-and-register-simulation-script";

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

  it("target-driven animator steps toward led_target and clamps overshoot", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const sourceText = `ref led = pwm#0
state led_target = 100%
state led_level = 0%

animator fade = ramp over 100ms ease linear

task apply every 10ms {
  set led_level = step fade with led_target dt
  do led.level(led_level)
}
`;
    const compileResult = compileSourceAndRegisterSimulationTasks({
      sourceText,
      sourceFileName: "target-driven.sc",
      simulationRuntime: runtime,
    });
    expect(compileResult.ok).toBe(true);

    const nominalTicksForRampCompletion = 10;
    for (let tickIndex = 0; tickIndex < nominalTicksForRampCompletion; tickIndex += 1) {
      runtime.tick(10);
    }
    expect(runtime.getDefaultDevices().pwm0.getLevelPercent()).toBe(100);

    for (let stableTickIndex = 0; stableTickIndex < 5; stableTickIndex += 1) {
      runtime.tick(10);
    }
    expect(runtime.getDefaultDevices().pwm0.getLevelPercent()).toBe(100);
  });

  it("target-driven animator restarts ramp when led_target changes mid-run", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const sourceText = `ref led = pwm#0
ref b = button#0
state led_target = 100%
state led_level = 0%

animator fade = ramp over 100ms ease linear

task apply every 10ms {
  set led_level = step fade with led_target dt
  do led.level(led_level)
}

task flip on b.pressed {
  set led_target = 0%
}
`;
    const compileResult = compileSourceAndRegisterSimulationTasks({
      sourceText,
      sourceFileName: "restart.sc",
      simulationRuntime: runtime,
    });
    expect(compileResult.ok).toBe(true);

    runtime.tick(10);
    const levelAfterFirstStep = runtime.getDefaultDevices().pwm0.getLevelPercent();
    expect(levelAfterFirstStep).toBeGreaterThan(0);

    runtime.dispatchScriptEvent({ deviceAddress: { kind: "button", id: 0 }, eventName: "pressed" });

    runtime.tick(10);
    const levelAfterRetarget = runtime.getDefaultDevices().pwm0.getLevelPercent();
    expect(levelAfterRetarget).toBeLessThan(levelAfterFirstStep);
  });

  it("target-driven step clamps out-of-range integer state at runtime", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const sourceText = `ref led = pwm#0
state led_hot = 999
state led_level = 0%

animator fade = ramp over 10ms ease linear

task apply every 10ms {
  set led_level = step fade with led_hot dt
  do led.level(led_level)
}
`;
    const compileResult = compileSourceAndRegisterSimulationTasks({
      sourceText,
      sourceFileName: "clamp.sc",
      simulationRuntime: runtime,
    });
    expect(compileResult.ok).toBe(true);

    runtime.tick(10);
    expect(runtime.getDefaultDevices().pwm0.getLevelPercent()).toBe(100);
  });

  it("fixed-endpoint animator step fade with dt remains monotonic one-shot ramp", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const sourceText = `ref led = pwm#0
state led_level = 0%
animator fade_in = ramp from 0% to 100% over 100ms ease linear

task fade every 10ms {
  set led_level = step fade_in with dt
  do led.level(led_level)
}
`;
    const compileResult = compileSourceAndRegisterSimulationTasks({
      sourceText,
      sourceFileName: "fixed.sc",
      simulationRuntime: runtime,
    });
    expect(compileResult.ok).toBe(true);

    runtime.tick(10);
    const first = runtime.getDefaultDevices().pwm0.getLevelPercent();
    runtime.tick(10);
    const second = runtime.getDefaultDevices().pwm0.getLevelPercent();
    expect(second).toBeGreaterThanOrEqual(first);
  });
});
