/**
 * LED の論理 on/off をユーザーが視認できる最小 UI。
 */

export type LedIndicatorView = {
  rootElement: HTMLElement;
  setLightOn(isLightOn: boolean): void;
};

export function createLedIndicatorView(params: {
  labelText: string;
}): LedIndicatorView {
  const outer = document.createElement("div");
  outer.className = "simulator-led-indicator";

  const label = document.createElement("div");
  label.className = "simulator-led-label";
  label.textContent = params.labelText;

  const lamp = document.createElement("div");
  lamp.className = "simulator-led-lamp";
  lamp.setAttribute("data-testid", "simulator-led-lamp");
  lamp.setAttribute("role", "img");
  lamp.setAttribute("aria-label", "LED off");

  outer.appendChild(label);
  outer.appendChild(lamp);

  function setLightOn(isLightOn: boolean): void {
    lamp.classList.toggle("simulator-led-lamp--on", isLightOn);
    lamp.setAttribute("aria-label", isLightOn ? "LED on" : "LED off");
  }

  setLightOn(false);

  return {
    rootElement: outer,
    setLightOn,
  };
}
