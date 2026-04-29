import { describe, expect, it } from "vitest";
import { parseInteractiveCommandLine } from "../../src/interactive/parse-interactive-command";
import { evaluateInteractiveCommand } from "../../src/interactive/evaluate-interactive-command";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";

describe("parseInteractiveCommandLine", () => {
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

  it("returns unsupported for garbage", () => {
    const bad = parseInteractiveCommandLine("not_a_command");
    expect(bad.ok).toBe(false);
  });
});
