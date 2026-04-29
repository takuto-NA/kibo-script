/**
 * 責務: SimulationRuntime が animator の `step` 評価の間で保持するランタイム状態の型定義と初期化。
 */

import type { CompiledAnimatorDefinition } from "./executable-task";

/**
 * `ramp from ... to ...` 固定エンドポイント: 経過 ms のみ保持し、毎 `step` で加算する。
 */
export type AnimatorFixedEndpointsRuntimeState = {
  readonly kind: "fixed_endpoints";
  elapsedMilliseconds: number;
};

/**
 * `ramp over ...` のみ: target は `step ... with <expr> dt` で与え、target 変更で再始動する。
 */
export type AnimatorTargetDrivenRuntimeState = {
  readonly kind: "target_driven";
  /** 直近の `step` が返す現在出力（整数パーセント、PWM レンジにクリップ済み想定）。 */
  currentOutputPercent: number;
  rampFromPercent: number;
  rampToPercent: number;
  elapsedMilliseconds: number;
  isRampRunning: boolean;
  lastTargetPercent: number | undefined;
};

export type AnimatorRuntimeState = AnimatorFixedEndpointsRuntimeState | AnimatorTargetDrivenRuntimeState;

export function createInitialAnimatorRuntimeState(definition: CompiledAnimatorDefinition): AnimatorRuntimeState {
  if (definition.rampKind === "from_to") {
    return { kind: "fixed_endpoints", elapsedMilliseconds: 0 };
  }

  return {
    kind: "target_driven",
    currentOutputPercent: 0,
    rampFromPercent: 0,
    rampToPercent: 0,
    elapsedMilliseconds: 0,
    isRampRunning: false,
    lastTargetPercent: undefined,
  };
}
