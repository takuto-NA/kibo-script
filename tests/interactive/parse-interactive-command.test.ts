import { describe, expect, it } from "vitest";
import { parseInteractiveCommandLine } from "../../src/interactive/parse-interactive-command";

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

  it("returns unsupported for garbage", () => {
    const bad = parseInteractiveCommandLine("not_a_command");
    expect(bad.ok).toBe(false);
  });
});
