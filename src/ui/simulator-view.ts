import { TaskRegistry } from "../core/task-registry";
import { SimulationRuntime } from "../core/simulation-runtime";
import { EmbedController } from "../embed/embed-controller";
import { TerminalSession } from "../interactive/terminal-session";
import { renderDisplayFrameToCanvas } from "./canvas-display-renderer";
import { createButton0PressView } from "./button-view";
import { createLedIndicatorView } from "./led-view";
import { createPwmLevelIndicatorView } from "./pwm-view";
import { createScriptRunnerPanel } from "./script-runner-view";
import { createTerminalView } from "./terminal-view";

import "./styles.css";

export type CreateSimulatorViewParams = {
  rootElementId: string;
};

/**
 * Mounts terminal + OLED canvas + embed bridge into the given root element.
 */
export function createSimulatorView(params: CreateSimulatorViewParams): void {
  const root = document.getElementById(params.rootElementId);
  if (root === null) {
    throw new Error(`Root element not found: #${params.rootElementId}`);
  }

  const tasks = new TaskRegistry();
  const runtime = new SimulationRuntime({ tasks });
  const session = new TerminalSession(runtime);
  const embedController = new EmbedController(runtime);

  const layout = document.createElement("div");
  layout.className = "simulator-layout";

  const terminalHost = document.createElement("div");
  terminalHost.className = "simulator-terminal-host";

  const scriptRunnerPanel = createScriptRunnerPanel({
    simulationRuntime: runtime,
    onAfterScriptLoaded: () => {
      refreshSimulatorOutputs();
    },
  });
  terminalHost.appendChild(scriptRunnerPanel.rootElement);

  const displayHost = document.createElement("div");
  displayHost.className = "simulator-display-host";
  const displayTitle = document.createElement("div");
  displayTitle.className = "simulator-display-title";
  displayTitle.textContent = "display#0 — 128×64 (SSD1306-style)";
  const canvas = document.createElement("canvas");
  canvas.className = "simulator-oled-canvas";
  displayHost.appendChild(displayTitle);
  displayHost.appendChild(canvas);

  const ledIndicatorView = createLedIndicatorView({ labelText: "led#0" });
  displayHost.appendChild(ledIndicatorView.rootElement);

  const pwmLevelView = createPwmLevelIndicatorView({ labelText: "pwm#0" });
  displayHost.appendChild(pwmLevelView.rootElement);

  const button0PressView = createButton0PressView({
    simulationRuntime: runtime,
    onAfterButtonPress: () => {
      refreshSimulatorOutputs();
    },
  });
  displayHost.appendChild(button0PressView.rootElement);

  layout.appendChild(terminalHost);
  layout.appendChild(displayHost);
  root.appendChild(layout);

  const terminalView = createTerminalView(terminalHost, session);
  terminalView.setOnSubmitLine(() => {
    refreshSimulatorOutputs();
  });
  terminalView.focusInput();

  function refreshSimulatorOutputs(): void {
    const frame = runtime.getDefaultDevices().display0.getPresentedFrameBytes();
    renderDisplayFrameToCanvas(canvas, frame);
    ledIndicatorView.setLightOn(runtime.getDefaultDevices().led0.isOn());
    pwmLevelView.setLevelPercent(runtime.getDefaultDevices().pwm0.getLevelPercent());
  }

  refreshSimulatorOutputs();

  const simulatorTickIntervalMilliseconds = 100;
  window.setInterval(() => {
    runtime.tick(simulatorTickIntervalMilliseconds);
    refreshSimulatorOutputs();
  }, simulatorTickIntervalMilliseconds);

  window.addEventListener("message", (event: MessageEvent) => {
    const result = embedController.handleMessage(event.data);
    if (result === undefined) {
      return;
    }
    const targetOrigin =
      typeof event.origin === "string" && event.origin.length > 0
        ? event.origin
        : "*";
    if (event.source instanceof Window) {
      event.source.postMessage(result, targetOrigin);
    }
    refreshSimulatorOutputs();
  });
}
