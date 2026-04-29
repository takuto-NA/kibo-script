/**
 * pwm#0 の duty（0–100%）をバーとテキストで表示する（フェード確認用）。
 */

export type PwmLevelIndicatorView = {
  rootElement: HTMLElement;
  setLevelPercent(levelPercent: number): void;
};

const MIN_PWM_PERCENT = 0;
const MAX_PWM_PERCENT = 100;

export function createPwmLevelIndicatorView(params: { labelText: string }): PwmLevelIndicatorView {
  const outer = document.createElement("div");
  outer.className = "simulator-pwm-indicator";

  const label = document.createElement("div");
  label.className = "simulator-pwm-label";
  label.textContent = params.labelText;

  const track = document.createElement("div");
  track.className = "simulator-pwm-track";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", String(MIN_PWM_PERCENT));
  track.setAttribute("aria-valuemax", String(MAX_PWM_PERCENT));

  const fill = document.createElement("div");
  fill.className = "simulator-pwm-fill";

  const text = document.createElement("div");
  text.className = "simulator-pwm-level-text";
  text.setAttribute("data-testid", "simulator-pwm-level-text");

  track.appendChild(fill);
  outer.appendChild(label);
  outer.appendChild(track);
  outer.appendChild(text);

  function setLevelPercent(levelPercent: number): void {
    const clamped = Math.min(MAX_PWM_PERCENT, Math.max(MIN_PWM_PERCENT, Math.round(levelPercent)));
    fill.style.width = `${clamped}%`;
    text.textContent = `${clamped}%`;
    track.setAttribute("aria-valuenow", String(clamped));
  }

  setLevelPercent(0);

  return {
    rootElement: outer,
    setLevelPercent,
  };
}
