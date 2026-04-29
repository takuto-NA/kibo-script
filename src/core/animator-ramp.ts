/**
 * animator ramp の補間（責務: linear / ease_in_out で 0–100% にクリップした整数を返す）。
 */

export const MIN_PWM_PERCENT = 0;
export const MAX_PWM_PERCENT = 100;

export function clampPercentToPwmRange(percent: number): number {
  const rounded = Math.round(percent);
  return Math.min(MAX_PWM_PERCENT, Math.max(MIN_PWM_PERCENT, rounded));
}

/**
 * 経過時間に対する ramp の現在値（端は目標へ収束、duration 超過後も overshoot しない）。
 */
export function interpolateAnimatorRampPercent(params: {
  readonly fromPercent: number;
  readonly toPercent: number;
  readonly durationMilliseconds: number;
  readonly elapsedMilliseconds: number;
  readonly ease: "linear" | "ease_in_out";
}): number {
  const { fromPercent, toPercent, durationMilliseconds, elapsedMilliseconds, ease } = params;
  if (durationMilliseconds <= 0) {
    return clampPercentToPwmRange(toPercent);
  }
  const normalizedTimeRatio = Math.min(1, Math.max(0, elapsedMilliseconds / durationMilliseconds));
  const easedTimeRatio = ease === "linear" ? normalizedTimeRatio : smoothstepZeroToOne(normalizedTimeRatio);
  const interpolated = fromPercent + (toPercent - fromPercent) * easedTimeRatio;
  return clampPercentToPwmRange(interpolated);
}

function smoothstepZeroToOne(timeRatio: number): number {
  const clamped = Math.min(1, Math.max(0, timeRatio));
  return clamped * clamped * (3 - 2 * clamped);
}
