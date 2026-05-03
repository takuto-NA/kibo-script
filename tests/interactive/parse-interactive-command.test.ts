import { describe, expect, it } from "vitest";
import { parseInteractiveCommandLine } from "../../src/interactive/parse-interactive-command";
import { evaluateInteractiveCommand } from "../../src/interactive/evaluate-interactive-command";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";

describe("parseInteractiveCommandLine", () => {
  it("accepts one-line interactive commands for all implemented device methods", () => {
    const supportedDeviceMethodCommands = [
      "do serial#0.println(\"hello\")",
      "do display#0.clear()",
      "do display#0.pixel(10, 20)",
      "do display#0.line(0, 0, 127, 63)",
      "do display#0.circle(64, 32, 8)",
      "do display#0.present()",
      "do led#0.on()",
      "do led#0.off()",
      "do led#0.toggle()",
      "do pwm#0.level(20)",
    ];

    for (const commandText of supportedDeviceMethodCommands) {
      const parsed = parseInteractiveCommandLine(commandText);
      expect(parsed.ok, commandText).toBe(true);
    }
  });

  it("parses read and do display", () => {
    const read = parseInteractiveCommandLine("read adc#0");
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.command.kind).toBe("read");
    }

    const pix = parseInteractiveCommandLine("do display#0.pixel(10, 20)");
    expect(pix.ok).toBe(true);
    if (pix.ok) {
      expect(pix.command.kind).toBe("do_display_pixel");
    }
  });

  it("parses do led#0.toggle()", () => {
    const led = parseInteractiveCommandLine("do led#0.toggle()");
    expect(led.ok).toBe(true);
    if (led.ok) {
      expect(led.command.kind).toBe("do_led_effect");
    }
  });

  it("parses and evaluates do pwm#0.level(percent)", () => {
    const parsed = parseInteractiveCommandLine("do pwm#0.level(20)");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.command).toEqual({
      kind: "do_pwm_level",
      pwmTargetText: "pwm#0",
      levelPercent: 20,
    });

    const runtime = new SimulationRuntime({ tasks: new TaskRegistry() });
    const evaluated = evaluateInteractiveCommand(runtime, parsed.command);

    expect(evaluated.ok).toBe(true);
    expect(runtime.getDefaultDevices().pwm0.getLevelPercent()).toBe(20);
  });

  it("returns unsupported for garbage", () => {
    const bad = parseInteractiveCommandLine("not_a_command");
    expect(bad.ok).toBe(false);
  });

  it("parses list refs, list vars, list states, ref-style info, and drop commands", () => {
    expect(parseInteractiveCommandLine("list refs").ok).toBe(true);
    expect(parseInteractiveCommandLine("list vars").ok).toBe(true);
    expect(parseInteractiveCommandLine("list states").ok).toBe(true);
    const refInfo = parseInteractiveCommandLine("led.info");
    expect(refInfo.ok).toBe(true);
    if (refInfo.ok) {
      expect(refInfo.command).toEqual({
        kind: "property_read",
        target: "led",
        property: "info",
      });
    }
    const dropRef = parseInteractiveCommandLine("drop ref myled");
    expect(dropRef.ok).toBe(true);
    if (dropRef.ok) {
      expect(dropRef.command).toEqual({ kind: "drop_ref", name: "myled" });
    }
  });
});
