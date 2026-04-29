/**
 * interactive shell の `task every { ... }` body を、tick 実行用 ExecutableStatement 列へ変換する。
 * `evaluateInteractiveCommand` は呼ばない（tick(0) の副作用を避ける）。
 */

import type { ExecutableStatement } from "../core/executable-task";
import type { InteractiveCommand } from "./interactive-command";
import { parseInteractiveCommandLine } from "./parse-interactive-command";
import { createDiagnosticReport } from "../diagnostics/diagnostic";
import type { DiagnosticReport } from "../diagnostics/diagnostic";
import { buildParseUnsupportedCommand } from "../diagnostics/diagnostic-builder";

export type CompileInteractiveTaskBodyResult =
  | { ok: true; executableStatements: ExecutableStatement[] }
  | { ok: false; report: DiagnosticReport };

export function compileInteractiveEveryTaskBodyToExecutableStatements(
  rawBodyText: string,
): CompileInteractiveTaskBodyResult {
  const executableStatements: ExecutableStatement[] = [];
  const bodyLines = rawBodyText.split("\n");

  for (const rawLine of bodyLines) {
    const trimmedLine = rawLine.trim();
    if (trimmedLine === "" || trimmedLine.startsWith("//")) {
      continue;
    }

    const parsedCommand = parseInteractiveCommandLine(trimmedLine);
    if (parsedCommand.ok === false) {
      return { ok: false, report: parsedCommand.report };
    }

    const mappedStatement = mapSupportedInteractiveCommandToExecutableStatement(
      parsedCommand.command,
    );
    if (mappedStatement === undefined) {
      return {
        ok: false,
        report: createDiagnosticReport([
          buildParseUnsupportedCommand({
            file: "<interactive>",
            inputLine: trimmedLine,
          }),
        ]),
      };
    }

    executableStatements.push(mappedStatement);
  }

  return { ok: true, executableStatements };
}

function mapSupportedInteractiveCommandToExecutableStatement(
  command: InteractiveCommand,
): ExecutableStatement | undefined {
  if (command.kind === "do_led_effect") {
    const methodName =
      command.ledEffect === "on" ? "on" : command.ledEffect === "off" ? "off" : "toggle";
    return {
      kind: "do_method_call",
      deviceAddress: { kind: "led", id: command.ledId },
      methodName,
      arguments: [],
    };
  }

  if (command.kind === "do_serial_println") {
    return {
      kind: "do_method_call",
      deviceAddress: { kind: "serial", id: 0 },
      methodName: "println",
      arguments: [{ kind: "string", value: command.text }],
    };
  }

  if (command.kind === "do_display_clear") {
    return {
      kind: "do_method_call",
      deviceAddress: { kind: "display", id: 0 },
      methodName: "clear",
      arguments: [],
    };
  }

  if (command.kind === "do_display_present") {
    return {
      kind: "do_method_call",
      deviceAddress: { kind: "display", id: 0 },
      methodName: "present",
      arguments: [],
    };
  }

  if (command.kind === "do_display_pixel") {
    return {
      kind: "do_method_call",
      deviceAddress: { kind: "display", id: 0 },
      methodName: "pixel",
      arguments: [
        { kind: "integer", value: command.x },
        { kind: "integer", value: command.y },
      ],
    };
  }

  if (command.kind === "do_display_line") {
    return {
      kind: "do_method_call",
      deviceAddress: { kind: "display", id: 0 },
      methodName: "line",
      arguments: [
        { kind: "integer", value: command.x0 },
        { kind: "integer", value: command.y0 },
        { kind: "integer", value: command.x1 },
        { kind: "integer", value: command.y1 },
      ],
    };
  }

  if (command.kind === "do_display_circle") {
    return {
      kind: "do_method_call",
      deviceAddress: { kind: "display", id: 0 },
      methodName: "circle",
      arguments: [
        { kind: "integer", value: command.centerX },
        { kind: "integer", value: command.centerY },
        { kind: "integer", value: command.radius },
      ],
    };
  }

  return undefined;
}
