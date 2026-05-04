import { TaskRegistry } from "../core/task-registry";
import { SimulationRuntime } from "../core/simulation-runtime";
import { EmbedController } from "../embed/embed-controller";
import { TerminalSession } from "../interactive/terminal-session";
import { createPhysicsWorldForBrowser } from "../physics/create-physics-world-for-browser";
import { NoopPhysicsWorld } from "../physics/noop-physics-world";
import { SwitchablePhysicsWorld } from "../physics/switchable-physics-world";
import { renderDisplayFrameToCanvas } from "./canvas-display-renderer";
import { createButtonPressView } from "./button-view";
import { createLedIndicatorView } from "./led-view";
import { createPhysicsSceneView } from "./physics-scene-view";
import { createPwmLevelIndicatorView } from "./pwm-view";
import { createScriptRunnerPanel } from "./script-runner-view";
import { createTerminalView, type TerminalView } from "./terminal-view";

import "./styles.css";

const MAX_SIMULATION_FRAME_DELTA_MILLISECONDS = 100;

const PHYSICS_CANVAS_WIDTH_CSS_PIXELS = 900;
const PHYSICS_CANVAS_HEIGHT_CSS_PIXELS = 560;
const PICO_BUTTON_PHYSICAL_PIN_LABELS = ["PIN24/GP18", "PIN25/GP19", "PIN26/GP20", "PIN27/GP21", "PIN29/GP22"] as const;

export type CreateSimulatorViewParams = {
  rootElementId: string;
};

/**
 * Mounts terminal + OLED canvas + physics view + embed bridge into the given root element.
 */
export async function createSimulatorView(params: CreateSimulatorViewParams): Promise<void> {
  const root = document.getElementById(params.rootElementId);
  if (root === null) {
    throw new Error(`Root element not found: #${params.rootElementId}`);
  }

  const physicsWorld = new SwitchablePhysicsWorld(new NoopPhysicsWorld());
  void createPhysicsWorldForBrowser().then((initializedPhysicsWorld) => {
    physicsWorld.replaceDelegate(initializedPhysicsWorld);
  });

  const tasks = new TaskRegistry();
  let terminalView: TerminalView | undefined;
  let isSubmittingInteractiveCommand = false;

  const runtime = new SimulationRuntime({
    tasks,
    physicsWorld,
    onAfterDeviceEffectApplied: (effect) => {
      if (effect.kind === "serial.println") {
        if (!isSubmittingInteractiveCommand) {
          flushSerialOutputToTerminal();
        }
        return;
      }
      if (effect.kind === "display.present") {
        refreshDisplayPreview();
        return;
      }
      if (effect.kind === "pwm.level") {
        refreshPwmPreview();
        return;
      }
      if (effect.kind === "led.on" || effect.kind === "led.off" || effect.kind === "led.toggle") {
        refreshLedPreview();
      }
    },
  });
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

  const buttonGroup = document.createElement("div");
  buttonGroup.className = "simulator-button-group";
  const buttonGroupLabel = document.createElement("div");
  buttonGroupLabel.className = "simulator-button-group-label";
  buttonGroupLabel.textContent = "buttons";
  buttonGroup.appendChild(buttonGroupLabel);
  runtime.getDefaultDevices().buttonDevices.forEach((buttonDevice, buttonDeviceId) => {
    const buttonPressView = createButtonPressView({
      simulationRuntime: runtime,
      buttonDevice,
      buttonDeviceId,
      physicalPinLabel: PICO_BUTTON_PHYSICAL_PIN_LABELS[buttonDeviceId],
      onAfterButtonPress: () => {
        refreshSimulatorOutputs();
      },
    });
    buttonGroup.appendChild(buttonPressView.rootElement);
  });
  displayHost.appendChild(buttonGroup);

  const physicsSceneView = createPhysicsSceneView({
    widthCssPixels: PHYSICS_CANVAS_WIDTH_CSS_PIXELS,
    heightCssPixels: PHYSICS_CANVAS_HEIGHT_CSS_PIXELS,
  });
  displayHost.appendChild(physicsSceneView.rootElement);

  layout.appendChild(terminalHost);
  layout.appendChild(displayHost);
  root.appendChild(layout);

  terminalView = createTerminalView(terminalHost, session);
  terminalView.setOnBeforeSubmitLine(() => {
    isSubmittingInteractiveCommand = true;
  });
  terminalView.setOnSubmitLine(() => {
    isSubmittingInteractiveCommand = false;
    refreshSimulatorOutputs();
  });
  terminalView.focusInput();

  function refreshSimulatorOutputs(): void {
    refreshDisplayPreview();
    refreshLedPreview();
    refreshPwmPreview();
  }

  function refreshDisplayPreview(): void {
    const frame = runtime.getDefaultDevices().display0.getPresentedFrameBytes();
    renderDisplayFrameToCanvas(canvas, frame);
  }

  function refreshLedPreview(): void {
    const isOn = runtime.getDefaultDevices().led0.isOn();
    ledIndicatorView.setLightOn(isOn);
    physicsSceneView.setLedLit(isOn);
  }

  function refreshPwmPreview(): void {
    pwmLevelView.setLevelPercent(runtime.getDefaultDevices().pwm0.getLevelPercent());
  }

  function flushSerialOutputToTerminal(): void {
    const serialLines = runtime.getDefaultDevices().serial0.takeOutputLines();
    for (const line of serialLines) {
      terminalView?.appendOutputLine(line);
    }
  }

  refreshSimulatorOutputs();
  physicsSceneView.syncFromPhysicsWorld(runtime.getPhysicsWorld());

  let previousFrameTimestampMilliseconds: number | undefined;
  function runSimulationFrame(timestampMilliseconds: number): void {
    if (previousFrameTimestampMilliseconds !== undefined) {
      const elapsedMilliseconds = Math.min(
        timestampMilliseconds - previousFrameTimestampMilliseconds,
        MAX_SIMULATION_FRAME_DELTA_MILLISECONDS,
      );
      runtime.tick(elapsedMilliseconds);
      runtime.getPhysicsWorld().step(elapsedMilliseconds);
      physicsSceneView.syncFromPhysicsWorld(runtime.getPhysicsWorld());
      physicsSceneView.setLedLit(runtime.getDefaultDevices().led0.isOn());
    }
    previousFrameTimestampMilliseconds = timestampMilliseconds;
    window.requestAnimationFrame(runSimulationFrame);
  }
  window.requestAnimationFrame(runSimulationFrame);

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
