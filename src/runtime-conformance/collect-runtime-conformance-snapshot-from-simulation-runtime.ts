// 責務: `SimulationRuntime` から runtime conformance trace 1 行分の観測値を収集する。
//
// 注意:
// - `scriptVarNamesToInclude` は trace に載せる変数名のみを明示する。fixture ごとに呼び出し側が決める。

import type { SimulationRuntime } from "../core/simulation-runtime";
import {
  computePresentedFrameFingerprintFnv1a64FromPresentedFrameBytes,
  formatFingerprintFnv1a64AsLowerHex16,
} from "./compute-presented-frame-fingerprint-fnv1a64";
import { buildRuntimeConformanceTraceLineText, type RuntimeConformanceScriptVarSnapshot } from "./build-runtime-conformance-trace-line-text";

export function collectRuntimeConformanceTraceLineTextFromSimulationRuntime(params: {
  readonly simulationRuntime: SimulationRuntime;
  readonly scriptVarNamesToInclude: readonly string[];
}): string {
  const devices = params.simulationRuntime.getDefaultDevices();
  const led0IsLightOn = devices.led0.isOn();
  const button0IsPressed = devices.button0.isPressedState();
  const presentedFrameBytes = devices.display0.getPresentedFrameBytes();
  const fingerprint = computePresentedFrameFingerprintFnv1a64FromPresentedFrameBytes(presentedFrameBytes);
  const fingerprintLowerHex16 = formatFingerprintFnv1a64AsLowerHex16(fingerprint);

  const scriptVarValues = params.simulationRuntime.getScriptVarValues();
  const scriptVarSnapshots: RuntimeConformanceScriptVarSnapshot[] = [];
  for (const scriptVarName of params.scriptVarNamesToInclude) {
    const scriptVarValue = scriptVarValues.get(scriptVarName);
    if (scriptVarValue === undefined) {
      continue;
    }
    scriptVarSnapshots.push({ scriptVarName, scriptVarValue });
  }

  return buildRuntimeConformanceTraceLineText({
    totalSimulationMilliseconds: params.simulationRuntime.getTotalSimulationMilliseconds(),
    led0IsLightOn,
    button0IsPressed,
    displayPresentedFrameFingerprintFnv1a64LowerHex16: fingerprintLowerHex16,
    scriptVarSnapshots,
    stateMachineInspectRows: params.simulationRuntime.listStateMachineInspectRows(),
  });
}
