import { compileSourceAndRegisterSimulationTasks } from "../core/compile-and-register-simulation-script";
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
      const ledOn = this.runtime.getDefaultDevices().led0.isOn();
      const pwmLevel = this.runtime.getDefaultDevices().pwm0.getLevelPercent();
      const buttonPressed = this.runtime.getDefaultDevices().button0.isPressedState();
      const bus = this.runtime.getDeviceBus();
      const motor0Power = bus.read({ address: { kind: "motor", id: 0 }, property: "power" });
      const motor1Power = bus.read({ address: { kind: "motor", id: 1 }, property: "power" });
      const servo0Angle = bus.read({ address: { kind: "servo", id: 0 }, property: "angle" });
      const imuRoll = bus.read({ address: { kind: "imu", id: 0 }, property: "roll" });
      const imuPitch = bus.read({ address: { kind: "imu", id: 0 }, property: "pitch" });
      const imuYaw = bus.read({ address: { kind: "imu", id: 0 }, property: "yaw" });
      const motor0PowerText = motor0Power?.tag === "integer" ? String(motor0Power.value) : "?";
      const motor1PowerText = motor1Power?.tag === "integer" ? String(motor1Power.value) : "?";
      const servo0AngleText = servo0Angle?.tag === "integer" ? String(servo0Angle.value) : "?";
      const imuRollText = imuRoll?.tag === "integer" ? String(imuRoll.value) : "?";
      const imuPitchText = imuPitch?.tag === "integer" ? String(imuPitch.value) : "?";
      const imuYawText = imuYaw?.tag === "integer" ? String(imuYaw.value) : "?";
      return {
        source: "kibo-simulator-parent",
        type: "simulator.response",
        requestId: message.requestId,
        ok: true,
        outputs: [
          `adc0.raw=${adc}`,
          `led0.on=${ledOn}`,
          `pwm0.level=${pwmLevel}`,
          `button0.pressed=${buttonPressed}`,
          `motor0.power=${motor0PowerText}`,
          `motor1.power=${motor1PowerText}`,
          `servo0.angle=${servo0AngleText}`,
          `imu0.roll_mdeg=${imuRollText}`,
          `imu0.pitch_mdeg=${imuPitchText}`,
          `imu0.yaw_mdeg=${imuYawText}`,
        ],
      };
    }
    if (message.type === "simulator.loadScript") {
      const loadResult = compileSourceAndRegisterSimulationTasks({
        sourceText: message.sourceText,
        sourceFileName: message.sourceFileName ?? "embed.sc",
        simulationRuntime: this.runtime,
      });
      if (loadResult.ok === false) {
        return {
          source: "kibo-simulator-parent",
          type: "simulator.response",
          requestId: message.requestId,
          ok: false,
          report: loadResult.report,
        };
      }
      return {
        source: "kibo-simulator-parent",
        type: "simulator.response",
        requestId: message.requestId,
        ok: true,
        outputs: [`registeredTasks=${loadResult.registeredTaskNames.join(",")}`],
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
