import { buildParseUnsupportedCommand } from "../diagnostics/diagnostic-builder";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import type { InteractiveCommand } from "./interactive-command";

const READ_DEVICE_DOT_PROPERTY_PATTERN = /^read\s+([a-z]+#\d+)\.([a-z_][a-z0-9_]*)\s*$/;
const READ_PATTERN = /^read\s+(\S+)$/;
const INFO_PATTERN = /^([a-z]+#\d+)\.info$/;
const DO_SERIAL_PRINTLN_PATTERN = /^do\s+serial#0\.println\((.*)\)\s*$/;
const DO_DISPLAY_CLEAR_PATTERN = /^do\s+display#0\.clear\(\)\s*$/;
const DO_DISPLAY_PIXEL_PATTERN =
  /^do\s+display#0\.pixel\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*$/;
const DO_DISPLAY_LINE_PATTERN =
  /^do\s+display#0\.line\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*$/;
const DO_DISPLAY_CIRCLE_PATTERN =
  /^do\s+display#0\.circle\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*$/;
const DO_DISPLAY_PRESENT_PATTERN = /^do\s+display#0\.present\(\)\s*$/;
const DO_LED_EFFECT_PATTERN = /^do\s+led#(\d+)\.(on|off|toggle)\(\)\s*$/;
const DO_PWM_LEVEL_PATTERN = /^do\s+pwm#(\d+)\.level\(\s*(-?\d+)\s*\)\s*$/;
const DO_MOTOR_POWER_PATTERN = /^do\s+motor#(\d+)\.power\(\s*(-?\d+)\s*\)\s*$/;
const DO_SERVO_ANGLE_PATTERN = /^do\s+servo#(\d+)\.angle\(\s*(-?\d+)\s*\)\s*$/;
const LIST_TASKS_PATTERN = /^list\s+tasks\s*$/;
const SHOW_TASK_PATTERN = /^show\s+task\s+(\S+)\s*$/;
const STOP_TASK_PATTERN = /^stop\s+task\s+(\S+)\s*$/;
const START_TASK_PATTERN = /^start\s+task\s+(\S+)\s*$/;
const DROP_TASK_PATTERN = /^drop\s+task\s+(\S+)\s*$/;
const TASK_EVERY_PATTERN =
  /^task\s+(\S+)\s+every\s+(\d+)ms\s*\{([\s\S]*)\}\s*$/;

export type ParseInteractiveCommandResult =
  | { ok: true; command: InteractiveCommand }
  | { ok: false; report: ReturnType<typeof createDiagnosticReport> };

export function parseInteractiveCommandLine(line: string): ParseInteractiveCommandResult {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("//")) {
    return {
      ok: false,
      report: createDiagnosticReport([
        buildParseUnsupportedCommand({
          file: "<interactive>",
          inputLine: trimmed,
        }),
      ]),
    };
  }

  if (trimmed === "help") {
    return { ok: true, command: { kind: "help" } };
  }

  const readDeviceDotPropertyMatch = READ_DEVICE_DOT_PROPERTY_PATTERN.exec(trimmed);
  if (readDeviceDotPropertyMatch !== null) {
    const deviceText = readDeviceDotPropertyMatch[1] ?? "";
    const propertyName = readDeviceDotPropertyMatch[2] ?? "";
    return {
      ok: true,
      command: {
        kind: "property_read",
        target: deviceText,
        property: propertyName,
      },
    };
  }

  const readMatch = READ_PATTERN.exec(trimmed);
  if (readMatch !== null) {
    const target = readMatch[1] ?? "";
    return { ok: true, command: { kind: "read", target } };
  }

  const infoMatch = INFO_PATTERN.exec(trimmed);
  if (infoMatch !== null) {
    const full = infoMatch[1] ?? "";
    return {
      ok: true,
      command: { kind: "property_read", target: full, property: "info" },
    };
  }

  const serialMatch = DO_SERIAL_PRINTLN_PATTERN.exec(trimmed);
  if (serialMatch !== null) {
    const rawArg = serialMatch[1]?.trim() ?? "";
    const parsedString = parseQuotedStringArgument(rawArg);
    if (parsedString === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnsupportedCommand({
            file: "<interactive>",
            inputLine: trimmed,
          }),
        ]),
      };
    }
    return { ok: true, command: { kind: "do_serial_println", text: parsedString } };
  }

  if (DO_DISPLAY_CLEAR_PATTERN.test(trimmed)) {
    return { ok: true, command: { kind: "do_display_clear" } };
  }

  const pixelMatch = DO_DISPLAY_PIXEL_PATTERN.exec(trimmed);
  if (pixelMatch !== null) {
    return {
      ok: true,
      command: {
        kind: "do_display_pixel",
        x: Number.parseInt(pixelMatch[1] ?? "0", 10),
        y: Number.parseInt(pixelMatch[2] ?? "0", 10),
      },
    };
  }

  const lineMatch = DO_DISPLAY_LINE_PATTERN.exec(trimmed);
  if (lineMatch !== null) {
    return {
      ok: true,
      command: {
        kind: "do_display_line",
        x0: Number.parseInt(lineMatch[1] ?? "0", 10),
        y0: Number.parseInt(lineMatch[2] ?? "0", 10),
        x1: Number.parseInt(lineMatch[3] ?? "0", 10),
        y1: Number.parseInt(lineMatch[4] ?? "0", 10),
      },
    };
  }

  const circleMatch = DO_DISPLAY_CIRCLE_PATTERN.exec(trimmed);
  if (circleMatch !== null) {
    return {
      ok: true,
      command: {
        kind: "do_display_circle",
        centerX: Number.parseInt(circleMatch[1] ?? "0", 10),
        centerY: Number.parseInt(circleMatch[2] ?? "0", 10),
        radius: Number.parseInt(circleMatch[3] ?? "0", 10),
      },
    };
  }

  if (DO_DISPLAY_PRESENT_PATTERN.test(trimmed)) {
    return { ok: true, command: { kind: "do_display_present" } };
  }

  const ledEffectMatch = DO_LED_EFFECT_PATTERN.exec(trimmed);
  if (ledEffectMatch !== null) {
    const ledId = Number.parseInt(ledEffectMatch[1] ?? "0", 10);
    const effectToken = ledEffectMatch[2] ?? "toggle";
    const ledEffect =
      effectToken === "on" ? ("on" as const) : effectToken === "off" ? ("off" as const) : ("toggle" as const);
    return {
      ok: true,
      command: {
        kind: "do_led_effect",
        ledId,
        ledEffect,
      },
    };
  }

  const pwmLevelMatch = DO_PWM_LEVEL_PATTERN.exec(trimmed);
  if (pwmLevelMatch !== null) {
    return {
      ok: true,
      command: {
        kind: "do_pwm_level",
        pwmId: Number.parseInt(pwmLevelMatch[1] ?? "0", 10),
        levelPercent: Number.parseInt(pwmLevelMatch[2] ?? "0", 10),
      },
    };
  }

  const motorPowerMatch = DO_MOTOR_POWER_PATTERN.exec(trimmed);
  if (motorPowerMatch !== null) {
    return {
      ok: true,
      command: {
        kind: "do_motor_power",
        motorId: Number.parseInt(motorPowerMatch[1] ?? "0", 10),
        powerPercent: Number.parseInt(motorPowerMatch[2] ?? "0", 10),
      },
    };
  }

  const servoAngleMatch = DO_SERVO_ANGLE_PATTERN.exec(trimmed);
  if (servoAngleMatch !== null) {
    return {
      ok: true,
      command: {
        kind: "do_servo_angle",
        servoId: Number.parseInt(servoAngleMatch[1] ?? "0", 10),
        angleDegrees: Number.parseInt(servoAngleMatch[2] ?? "0", 10),
      },
    };
  }

  if (LIST_TASKS_PATTERN.test(trimmed)) {
    return { ok: true, command: { kind: "list_tasks" } };
  }

  const showMatch = SHOW_TASK_PATTERN.exec(trimmed);
  if (showMatch !== null) {
    return { ok: true, command: { kind: "show_task", name: showMatch[1] ?? "" } };
  }

  const stopMatch = STOP_TASK_PATTERN.exec(trimmed);
  if (stopMatch !== null) {
    return { ok: true, command: { kind: "stop_task", name: stopMatch[1] ?? "" } };
  }

  const startMatch = START_TASK_PATTERN.exec(trimmed);
  if (startMatch !== null) {
    return { ok: true, command: { kind: "start_task", name: startMatch[1] ?? "" } };
  }

  const dropMatch = DROP_TASK_PATTERN.exec(trimmed);
  if (dropMatch !== null) {
    return { ok: true, command: { kind: "drop_task", name: dropMatch[1] ?? "" } };
  }

  const taskEveryMatch = TASK_EVERY_PATTERN.exec(trimmed);
  if (taskEveryMatch !== null) {
    const name = taskEveryMatch[1] ?? "";
    const intervalMs = Number.parseInt(taskEveryMatch[2] ?? "0", 10);
    const body = taskEveryMatch[3] ?? "";
    return {
      ok: true,
      command: {
        kind: "register_task_every",
        name,
        intervalMs,
        body,
      },
    };
  }

  return {
    ok: false,
    report: createDiagnosticReport([
      buildParseUnsupportedCommand({
        file: "<interactive>",
        inputLine: trimmed,
      }),
    ]),
  };
}

function parseQuotedStringArgument(raw: string): string | undefined {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) {
    return undefined;
  }
  const inner = raw.slice(1, -1);
  return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}
