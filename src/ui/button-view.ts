/**
 * 責務: シミュレータ上の `button#N` を表す UI。クリックで短く押下状態にし、
 * `dispatchScriptEvent` により `button#N.pressed` 向け `task on` を起動する。
 */

import type { SimulationRuntime } from "../core/simulation-runtime";
import type { ButtonDevice } from "../devices/button-device";

export type ButtonPressView = {
  rootElement: HTMLElement;
};

export function createButtonPressView(params: {
  simulationRuntime: SimulationRuntime;
  buttonDevice: ButtonDevice;
  buttonDeviceId: number;
  physicalPinLabel?: string;
  onAfterButtonPress: () => void;
}): ButtonPressView {
  const outer = document.createElement("div");
  outer.className = "simulator-button";

  const label = document.createElement("div");
  label.className = "simulator-button-label";
  const physicalPinText = params.physicalPinLabel !== undefined ? ` (${params.physicalPinLabel})` : "";
  label.textContent = `button#${params.buttonDeviceId}${physicalPinText}`;

  const pressButton = document.createElement("button");
  pressButton.type = "button";
  pressButton.className = "simulator-button-press";
  pressButton.setAttribute("data-testid", `simulator-button${params.buttonDeviceId}-press`);
  pressButton.setAttribute("aria-label", `Press button#${params.buttonDeviceId}`);
  pressButton.textContent = "Press";

  pressButton.addEventListener("click", () => {
    // ガード: 物理ボタン相当の一瞬の押下。read 用 state のみで、task フィルタは event 名で一致する。
    params.buttonDevice.setSimulatedPressed(true);
    params.simulationRuntime.dispatchScriptEvent({
      deviceAddress: { kind: "button", id: params.buttonDeviceId },
      eventName: "pressed",
    });
    params.buttonDevice.setSimulatedPressed(false);
    params.onAfterButtonPress();
  });

  outer.appendChild(label);
  outer.appendChild(pressButton);

  return { rootElement: outer };
}
