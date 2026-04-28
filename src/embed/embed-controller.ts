import { createDiagnosticReport } from "../diagnostics/diagnostic";
import type { SimulationRuntime } from "../core/simulation-runtime";
import { evaluateInteractiveCommand } from "../interactive/evaluate-interactive-command";
import { parseInteractiveCommandLine } from "../interactive/parse-interactive-command";
import type { EmbedIncomingMessage, EmbedOutgoingMessage } from "./embed-message";

/**
 * Bridges iframe/WebView postMessage to simulator runtime (Unity/host embedding).
 */
export class EmbedController {
  private readonly runtime: SimulationRuntime;

  public constructor(runtime: SimulationRuntime) {
    this.runtime = runtime;
  }

  public handleMessage(raw: unknown): EmbedOutgoingMessage | undefined {
    if (typeof raw !== "object" || raw === null) {
      return undefined;
    }
    const message = raw as EmbedIncomingMessage;
    if (message.source !== "kibo-simulator-parent") {
      return undefined;
    }

    if (message.type === "simulator.command") {
      return this.handleCommandMessage(message);
    }
    if (message.type === "simulator.tick") {
      this.runtime.tick(message.elapsedMilliseconds);
      return {
        source: "kibo-simulator-parent",
        type: "simulator.response",
        requestId: message.requestId,
        ok: true,
        outputs: [],
      };
    }
    if (message.type === "simulator.setAdcValue") {
      this.runtime.getDefaultDevices().adc0.setSimulatedRawValue(message.raw);
      return {
        source: "kibo-simulator-parent",
        type: "simulator.response",
        requestId: message.requestId,
        ok: true,
        outputs: [],
      };
    }
    if (message.type === "simulator.getDisplayFrame") {
      const frame = this.runtime
        .getDefaultDevices()
        .display0.getPresentedFrameBytes();
      return {
        source: "kibo-simulator-parent",
        type: "simulator.response",
        requestId: message.requestId,
        ok: true,
        outputs: [Array.from(frame).join(",")],
      };
    }
    if (message.type === "simulator.getSnapshot") {
      const adc = this.runtime.getDefaultDevices().adc0.getSimulatedRawValue();
      return {
        source: "kibo-simulator-parent",
        type: "simulator.response",
        requestId: message.requestId,
        ok: true,
        outputs: [`adc0.raw=${adc}`],
      };
    }
    return undefined;
  }

  private handleCommandMessage(
    message: Extract<EmbedIncomingMessage, { type: "simulator.command" }>,
  ): EmbedOutgoingMessage {
    const parsed = parseInteractiveCommandLine(message.commandLine);
    if (!parsed.ok) {
      return {
        source: "kibo-simulator-parent",
        type: "simulator.response",
        requestId: message.requestId,
        ok: false,
        report: parsed.report,
      };
    }
    const evaluated = evaluateInteractiveCommand(this.runtime, parsed.command);
    if (!evaluated.ok) {
      return {
        source: "kibo-simulator-parent",
        type: "simulator.response",
        requestId: message.requestId,
        ok: false,
        report: evaluated.report,
      };
    }
    return {
      source: "kibo-simulator-parent",
      type: "simulator.response",
      requestId: message.requestId,
      ok: true,
      outputs: evaluated.lines,
      diagnosticReport: evaluated.diagnosticReport,
    };
  }
}

export function createUnknownMessageErrorResponse(
  requestId: string,
): EmbedOutgoingMessage {
  return {
    source: "kibo-simulator-parent",
    type: "simulator.response",
    requestId,
    ok: false,
    report: createDiagnosticReport([
      {
        id: "embed.unknown_message",
        severity: "error",
        phase: "runtime",
        message: "Unknown embed message.",
      },
    ]),
  };
}
