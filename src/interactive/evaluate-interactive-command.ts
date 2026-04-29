import {
  buildDeviceUnknownTarget,
  buildParseUnsupportedCommand,
  buildRuntimeOutOfRange,
  buildTaskUnknown,
} from "../diagnostics/diagnostic-builder";
import { createDiagnosticReport, type DiagnosticReport } from "../diagnostics/diagnostic";
import { formatDiagnosticForTerminal } from "../diagnostics/format-diagnostic";
import type { DeviceEffect } from "../core/device-bus";
import { parseDeviceAddress } from "../core/device-address";
import type { SimulationRuntime } from "../core/simulation-runtime";
import { formatScriptValueForInteractiveEcho } from "../core/value";
import {
  DISPLAY_HEIGHT_PIXELS,
  DISPLAY_WIDTH_PIXELS,
} from "../devices/display/display-constants";
import { isCoordinateInDisplayRange } from "../devices/display/display-device";
import { compileInteractiveEveryTaskBodyToExecutableStatements } from "./compile-interactive-task-body";
import type { InteractiveCommand } from "./interactive-command";

export type EvaluateSuccess = {
  ok: true;
  lines: string[];
  diagnosticReport?: DiagnosticReport;
};

export type EvaluateFailure = {
  ok: false;
  report: DiagnosticReport;
};

export type EvaluateInteractiveResult = EvaluateSuccess | EvaluateFailure;

function displayAddress() {
  return { kind: "display" as const, id: 0 };
}

function serialAddress() {
  return { kind: "serial" as const, id: 0 };
}

function ledAddress(ledId: number) {
  return { kind: "led" as const, id: ledId };
}

function pwmAddress(pwmId: number) {
  return { kind: "pwm" as const, id: pwmId };
}

function motorAddress(motorId: number) {
  return { kind: "motor" as const, id: motorId };
}

function servoAddress(servoId: number) {
  return { kind: "servo" as const, id: servoId };
}

/**
 * Evaluates one interactive command against the simulation runtime (queues effects, ticks).
 */
export function evaluateInteractiveCommand(
  runtime: SimulationRuntime,
  command: InteractiveCommand,
): EvaluateInteractiveResult {
  const lines: string[] = [];

  if (command.kind === "help") {
    lines.push(
      [
        "Commands:",
        "  read adc#0",
        "  adc#0.info",
        "  display#0.info",
        '  do serial#0.println("text")',
        "  do display#0.clear()",
        "  do display#0.pixel(x, y)",
        "  do display#0.line(x0,y0,x1,y1)",
        "  do display#0.circle(cx,cy,r)",
        "  do display#0.present()",
        "  do led#0.on() | do led#0.off() | do led#0.toggle()",
        "  led#0.info",
        "  do pwm#0.level(percent)",
        "  pwm#0.info",
        "  do motor#0.power(percent)",
        "  do motor#1.power(percent)",
        "  do servo#0.angle(degrees)",
        "  read imu#0.roll",
        "  read motor#0.power",
        "  motor#0.info",
        "  list tasks",
        "  show task <name>",
        "  start task <name> | stop task <name> | drop task <name>",
        "  task <name> every <N>ms { ... }",
      ].join("\n"),
    );
    return { ok: true, lines };
  }

  if (command.kind === "read") {
    const parsed = parseDeviceAddress(command.target);
    if (!parsed.ok) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnsupportedCommand({
            file: "<interactive>",
            inputLine: command.target,
          }),
        ]),
      };
    }
    const bus = runtime.getDeviceBus();
    const value = bus.read({
      address: parsed.address,
      property: "",
    });
    if (value === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildDeviceUnknownTarget({
            kindName: parsed.address.kind,
            id: parsed.address.id,
          }),
        ]),
      };
    }
    const echoTarget = `${parsed.address.kind}#${parsed.address.id}`;
    lines.push(`${echoTarget} = ${formatScriptValueForInteractiveEcho(value)}`);
    return { ok: true, lines };
  }

  if (command.kind === "property_read") {
    const base = command.target.replace(/\.info$/, "");
    const parsed = parseDeviceAddress(base);
    if (!parsed.ok) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnsupportedCommand({
            file: "<interactive>",
            inputLine: command.target,
          }),
        ]),
      };
    }
    const bus = runtime.getDeviceBus();
    const value = bus.read({
      address: parsed.address,
      property: command.property,
    });
    if (value === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildDeviceUnknownTarget({
            kindName: parsed.address.kind,
            id: parsed.address.id,
          }),
        ]),
      };
    }
    lines.push(formatScriptValueForInteractiveEcho(value));
    return { ok: true, lines };
  }

  if (command.kind === "do_serial_println") {
    const effect: DeviceEffect = {
      kind: "serial.println",
      address: serialAddress(),
      text: command.text,
    };
    runtime.queueEffect(effect);
    runtime.tick(0);
    const serial = runtime.getDefaultDevices().serial0;
    const printed = serial.takeOutputLines();
    for (const line of printed) {
      lines.push(line);
    }
    return { ok: true, lines };
  }

  if (command.kind === "do_display_clear") {
    runtime.queueEffect({ kind: "display.clear", address: displayAddress() });
    runtime.tick(0);
    return { ok: true, lines: ["ok"] };
  }

  if (command.kind === "do_display_pixel") {
    if (!isCoordinateInDisplayRange(command.x, command.y)) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildRuntimeOutOfRange({
            message: `Pixel (${command.x}, ${command.y}) is outside ${DISPLAY_WIDTH_PIXELS}x${DISPLAY_HEIGHT_PIXELS}.`,
          }),
        ]),
      };
    }
    runtime.queueEffect({
      kind: "display.pixel",
      address: displayAddress(),
      x: command.x,
      y: command.y,
      on: true,
    });
    runtime.tick(0);
    return { ok: true, lines: ["ok"] };
  }

  if (command.kind === "do_display_line") {
    runtime.queueEffect({
      kind: "display.line",
      address: displayAddress(),
      x0: command.x0,
      y0: command.y0,
      x1: command.x1,
      y1: command.y1,
    });
    runtime.tick(0);
    return { ok: true, lines: ["ok"] };
  }

  if (command.kind === "do_display_circle") {
    runtime.queueEffect({
      kind: "display.circle",
      address: displayAddress(),
      centerX: command.centerX,
      centerY: command.centerY,
      radius: command.radius,
    });
    runtime.tick(0);
    return { ok: true, lines: ["ok"] };
  }

  if (command.kind === "do_display_present") {
    runtime.queueEffect({ kind: "display.present", address: displayAddress() });
    runtime.tick(0);
    return { ok: true, lines: ["ok"] };
  }

  if (command.kind === "do_led_effect") {
    const address = ledAddress(command.ledId);
    const deviceEffect =
      command.ledEffect === "on"
        ? ({ kind: "led.on" as const, address })
        : command.ledEffect === "off"
          ? ({ kind: "led.off" as const, address })
          : ({ kind: "led.toggle" as const, address });
    runtime.queueEffect(deviceEffect);
    runtime.tick(0);
    return { ok: true, lines: ["ok"] };
  }

  if (command.kind === "do_pwm_level") {
    runtime.queueEffect({
      kind: "pwm.level",
      address: pwmAddress(command.pwmId),
      levelPercent: command.levelPercent,
    });
    runtime.tick(0);
    return { ok: true, lines: ["ok"] };
  }

  if (command.kind === "do_motor_power") {
    runtime.queueEffect({
      kind: "motor.power",
      address: motorAddress(command.motorId),
      powerPercent: command.powerPercent,
    });
    runtime.tick(0);
    return { ok: true, lines: ["ok"] };
  }

  if (command.kind === "do_servo_angle") {
    runtime.queueEffect({
      kind: "servo.angle",
      address: servoAddress(command.servoId),
      angleDegrees: command.angleDegrees,
    });
    runtime.tick(0);
    return { ok: true, lines: ["ok"] };
  }

  if (command.kind === "list_tasks") {
    const tasks = runtime.tasks.listTasks();
    if (tasks.length === 0) {
      lines.push("(no tasks)");
      return { ok: true, lines };
    }
    for (const task of tasks) {
      const mode =
        task.runMode === "every"
          ? `every ${task.intervalMilliseconds ?? "?"}ms`
          : `on ${task.eventExpression ?? "?"}`;
      lines.push(
        `${task.name}\t${task.running ? "running" : "stopped"}\t${mode}`,
      );
    }
    return { ok: true, lines };
  }

  if (command.kind === "show_task") {
    const task = runtime.tasks.getTask(command.name);
    if (task === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([buildTaskUnknown({ taskName: command.name })]),
      };
    }
    lines.push(`name: ${task.name}`);
    lines.push(`running: ${task.running}`);
    lines.push(`mode: ${task.runMode}`);
    if (task.intervalMilliseconds !== undefined) {
      lines.push(`intervalMs: ${task.intervalMilliseconds}`);
    }
    if (task.eventExpression !== undefined) {
      lines.push(`event: ${task.eventExpression}`);
    }
    lines.push(`body:\n${task.body}`);
    return { ok: true, lines };
  }

  if (command.kind === "stop_task") {
    const ok = runtime.tasks.stopTask(command.name);
    lines.push(ok ? "ok" : `unknown task ${command.name}`);
    return { ok: true, lines };
  }

  if (command.kind === "start_task") {
    const ok = runtime.tasks.startTask(command.name);
    lines.push(ok ? "ok" : `unknown task ${command.name}`);
    return { ok: true, lines };
  }

  if (command.kind === "drop_task") {
    const removed = runtime.tasks.removeTask(command.name);
    lines.push(removed ? "ok" : `unknown task ${command.name}`);
    return { ok: true, lines };
  }

  if (command.kind === "register_task_every") {
    const bodyCompileResult = compileInteractiveEveryTaskBodyToExecutableStatements(command.body);
    if (bodyCompileResult.ok === false) {
      return { ok: false, report: bodyCompileResult.report };
    }

    runtime.tasks.registerTask({
      name: command.name,
      runMode: "every",
      intervalMilliseconds: command.intervalMs,
      running: true,
      accumulatedMilliseconds: 0,
      body: command.body.trim(),
      eventExpression: undefined,
      compiledStatements: bodyCompileResult.executableStatements,
      executionProgress: undefined,
      onEventFilter: undefined,
    });
    lines.push(`registered task ${command.name}`);
    return { ok: true, lines };
  }

  const exhaustiveCheck: never = command;
  return {
    ok: false,
    report: createDiagnosticReport([
      {
        id: "runtime.unreachable",
        severity: "error",
        phase: "runtime",
        message: `Unhandled command: ${String(exhaustiveCheck)}`,
      },
    ]),
  };
}

export function formatEvaluateFailureForTerminal(report: DiagnosticReport): string[] {
  return report.diagnostics.map((diagnostic) =>
    formatDiagnosticForTerminal(diagnostic),
  );
}
