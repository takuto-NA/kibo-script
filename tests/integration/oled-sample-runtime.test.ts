/**
 * OLED サンプルスクリプトを compile し、display#0 の presented frame へ描画されることを確認する。
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScript } from "../../src/compiler/compile-script";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";

const testsIntegrationDirectory = dirname(fileURLToPath(import.meta.url));
const testsDirectory = dirname(testsIntegrationDirectory);
const DISPLAY_WIDTH_PIXELS = 128;

describe("OLED sample runtime", () => {
  it("draws the oled dashboard sample into display#0", () => {
    const fixturePath = join(testsDirectory, "compiler", "fixtures", "oled-dashboard.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const compileResult = compileScript(sourceText, "oled-dashboard.sc");
    expect(
      compileResult.ok,
      compileResult.ok === false ? JSON.stringify(compileResult.report.diagnostics, null, 2) : "",
    ).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const runtime = new SimulationRuntime({ tasks: new TaskRegistry() });
    runtime.replaceCompiledProgram(compileResult.program);

    runtime.tick(100);

    const sweepFrame = runtime.getDefaultDevices().display0.getPresentedFrameBytes();
    expect(sweepFrame[pixelOffset(0, 0)]).toBe(1);
    expect(sweepFrame[pixelOffset(127, 0)]).toBe(1);
    expect(sweepFrame[pixelOffset(0, 63)]).toBe(1);
    expect(sweepFrame[pixelOffset(127, 63)]).toBe(1);
    expect(sweepFrame[pixelOffset(8, 56)]).toBe(1);
    expect(runtime.getScriptVarValues().get("scan_x")).toBe(16);
    expect(runtime.getScriptVarValues().get("pulse_radius")).toBe(3);
    expect(runtime.getScriptVarValues().get("requested_mode")).toBe("sweep");

    runtime.dispatchScriptEvent({
      deviceAddress: { kind: "button", id: 0 },
      eventName: "pressed",
    });
    expect(runtime.getScriptVarValues().get("requested_mode")).toBe("pulse");

    runtime.tick(100);

    const pulseFrame = runtime.getDefaultDevices().display0.getPresentedFrameBytes();
    expect(pulseFrame[pixelOffset(48, 16)]).toBe(1);
    expect(pulseFrame[pixelOffset(80, 40)]).toBe(1);
    expect(pulseFrame[pixelOffset(64, 56)]).toBe(1);
    expect(runtime.getScriptVarValues().get("scan_x")).toBe(16);
    expect(runtime.getScriptVarValues().get("pulse_radius")).toBe(4);

    runtime.dispatchScriptEvent({
      deviceAddress: { kind: "button", id: 0 },
      eventName: "pressed",
    });
    expect(runtime.getScriptVarValues().get("requested_mode")).toBe("sweep");

    runtime.tick(100);

    expect(runtime.getScriptVarValues().get("scan_x")).toBe(24);
    expect(runtime.getScriptVarValues().get("pulse_radius")).toBe(4);
  });
});

function pixelOffset(x: number, y: number): number {
  return y * DISPLAY_WIDTH_PIXELS + x;
}
