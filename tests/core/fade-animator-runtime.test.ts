/**
 * Fade animator と SimulationRuntime の結合テスト（責務: ramp + step が pwm level に反映されること）。
 */

import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";

const SIMULATION_TICK_INTERVAL_MS = 100;
const TASK_INTERVAL_MS = 100;

describe("fade animator runtime integration", () => {
  it("linear fade-in reaches 100% pwm level after ramp duration at nominal dt", () => {
    const sourceText = `
ref led = pwm#0
var led_level = 0%
animator fade_in = ramp from 0% to 100% over 1000ms ease linear

task fade every ${TASK_INTERVAL_MS}ms {
  set led_level = step fade_in with dt
  do led.level(led_level)
}
`;
    const compileResult = compileScript(sourceText, "fade.integration.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    runtime.replaceCompiledProgram(compileResult.program);

    const activationCountForFullRamp =
      compileResult.program.animatorDefinitions[0]!.durationMilliseconds / TASK_INTERVAL_MS;

    for (let tickIndex = 0; tickIndex < activationCountForFullRamp; tickIndex += 1) {
      runtime.tick(SIMULATION_TICK_INTERVAL_MS);
    }

    expect(runtime.getDefaultDevices().pwm0.getLevelPercent()).toBe(100);
  });

  it("linear fade-in is near half magnitude halfway through elapsed ramp time", () => {
    const rampDurationMs = 1000;
    const sourceText = `
ref led = pwm#0
var led_level = 0%
animator fade_in = ramp from 0% to 100% over ${rampDurationMs}ms ease linear

task fade every ${TASK_INTERVAL_MS}ms {
  set led_level = step fade_in with dt
  do led.level(led_level)
}
`;
    const compileResult = compileScript(sourceText, "fade.halfway.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    runtime.replaceCompiledProgram(compileResult.program);

    const halfwayActivationCount = rampDurationMs / TASK_INTERVAL_MS / 2;
    for (let tickIndex = 0; tickIndex < halfwayActivationCount; tickIndex += 1) {
      runtime.tick(SIMULATION_TICK_INTERVAL_MS);
    }

    expect(runtime.getDefaultDevices().pwm0.getLevelPercent()).toBe(50);
  });

  it("linear fade-out is near half magnitude halfway through elapsed ramp time", () => {
    const rampDurationMs = 1000;
    const sourceText = `
ref led = pwm#0
var led_level = 0%
animator fade_out = ramp from 100% to 0% over ${rampDurationMs}ms ease linear

task fade every ${TASK_INTERVAL_MS}ms {
  set led_level = step fade_out with dt
  do led.level(led_level)
}
`;
    const compileResult = compileScript(sourceText, "fade.out.halfway.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    runtime.replaceCompiledProgram(compileResult.program);

    const halfwayActivationCount = rampDurationMs / TASK_INTERVAL_MS / 2;
    for (let tickIndex = 0; tickIndex < halfwayActivationCount; tickIndex += 1) {
      runtime.tick(SIMULATION_TICK_INTERVAL_MS);
    }

    expect(runtime.getDefaultDevices().pwm0.getLevelPercent()).toBe(50);
  });

  it("does not overshoot target after ramp completes", () => {
    const sourceText = `
ref led = pwm#0
var led_level = 0%
animator fade_in = ramp from 0% to 100% over 300ms ease linear

task fade every ${TASK_INTERVAL_MS}ms {
  set led_level = step fade_in with dt
  do led.level(led_level)
}
`;
    const compileResult = compileScript(sourceText, "fade.overshoot.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    runtime.replaceCompiledProgram(compileResult.program);

    const activationCountForFullRamp =
      compileResult.program.animatorDefinitions[0]!.durationMilliseconds / TASK_INTERVAL_MS;

    for (let tickIndex = 0; tickIndex < activationCountForFullRamp + 5; tickIndex += 1) {
      runtime.tick(SIMULATION_TICK_INTERVAL_MS);
    }

    expect(runtime.getDefaultDevices().pwm0.getLevelPercent()).toBe(100);
  });
});
