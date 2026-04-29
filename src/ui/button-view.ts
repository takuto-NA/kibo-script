/**
 * 責務: シミュレータ上の `button#0` を表す UI。クリックで短く押下状態にし、
 * `dispatchScriptEvent` により `button#0.pressed` 向け `task on` を起動する。
 */

import type { SimulationRuntime } from "../core/simulation-runtime";

export type Button0PressView = {
  rootElement: HTMLElement;
};

export function createButton0PressView(params: {
  simulationRuntime: SimulationRuntime;
  onAfterButtonPress: () => void;
}): Button0PressView {
  const outer = document.createElement("div");
  outer.className = "simulator-button0";

  const label = document.createElement("div");
  label.className = "simulator-button0-label";
  label.textContent = "button#0";

  const pressButton = document.createElement("button");
  pressButton.type = "button";
  pressButton.className = "simulator-button0-press";
  pressButton.setAttribute("data-testid", "simulator-button0-press");
  pressButton.setAttribute("aria-label", "Press button#0");
  pressButton.textContent = "Press";

  pressButton.addEventListener("click", () => {
    const buttonDevice = params.simulationRuntime.getDefaultDevices().button0;
    // ガード: 物理ボタン相当の一瞬の押下。read 用 state のみで、task フィルタは event 名で一致する。
    buttonDevice.setSimulatedPressed(true);
    params.simulationRuntime.dispatchScriptEvent({
      deviceAddress: { kind: "button", id: 0 },
      eventName: "pressed",
    });
    buttonDevice.setSimulatedPressed(false);
    params.onAfterButtonPress();
  });

  outer.appendChild(label);
  outer.appendChild(pressButton);

  return { rootElement: outer };
}
