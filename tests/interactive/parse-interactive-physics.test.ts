import { describe, expect, it } from "vitest";
import { parseInteractiveCommandLine } from "../../src/interactive/parse-interactive-command";

describe("parseInteractiveCommandLine physics MVP", () => {
  it("parses read imu#0.roll", () => {
    const parsed = parseInteractiveCommandLine("read imu#0.roll");
    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      return;
    }
    expect(parsed.command).toEqual({
      kind: "property_read",
      target: "imu#0",
      property: "roll",
    });
  });

  it("parses do motor#0.power(-40)", () => {
    const parsed = parseInteractiveCommandLine("do motor#0.power(-40)");
    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      return;
    }
    expect(parsed.command).toEqual({
      kind: "do_motor_power",
      motorId: 0,
      powerPercent: -40,
    });
  });

  it("parses do servo#0.angle(12)", () => {
    const parsed = parseInteractiveCommandLine("do servo#0.angle(12)");
    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) {
      return;
    }
    expect(parsed.command).toEqual({
      kind: "do_servo_angle",
      servoId: 0,
      angleDegrees: 12,
    });
  });
});
