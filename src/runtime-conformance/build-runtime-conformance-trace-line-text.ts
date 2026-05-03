// 責務: TypeScript SimulationRuntime / C++ host runtime / Pico firmware が同じ形式で出力する conformance trace 1 行を組み立てる。
//
// 注意:
// - 行形式の詳細は `docs/runtime-conformance.md` を正とする。
// - フィールド順と区切り文字を変えない。golden 比較が壊れる。

import type { RuntimeWorldStateMachineInspectRow } from "../core/simulation-runtime";

export const RUNTIME_CONFORMANCE_TRACE_SCHEMA_VERSION = "1" as const;

export type RuntimeConformanceScriptVarSnapshot = {
  readonly scriptVarName: string;
  readonly scriptVarValue: number | string;
};

function compareScriptVarSnapshotsByName(
  left: RuntimeConformanceScriptVarSnapshot,
  right: RuntimeConformanceScriptVarSnapshot,
): number {
  return left.scriptVarName.localeCompare(right.scriptVarName);
}

function compareStateMachineInspectRowsByMachineName(
  left: RuntimeWorldStateMachineInspectRow,
  right: RuntimeWorldStateMachineInspectRow,
): number {
  return left.machineName.localeCompare(right.machineName);
}

function encodeScriptVarValueForTrace(scriptVarValue: number | string): string {
  if (typeof scriptVarValue === "number") {
    return String(scriptVarValue);
  }
  const normalizedText = scriptVarValue.replaceAll("|", "\\|").replaceAll("=", "\\=");
  return `"${normalizedText}"`;
}

function buildScriptVarsSegmentText(scriptVarSnapshots: readonly RuntimeConformanceScriptVarSnapshot[]): string {
  if (scriptVarSnapshots.length === 0) {
    return "-";
  }
  const sortedSnapshots = [...scriptVarSnapshots].sort(compareScriptVarSnapshotsByName);
  const encodedPairs = sortedSnapshots.map((snapshot) => {
    return `${snapshot.scriptVarName}=${encodeScriptVarValueForTrace(snapshot.scriptVarValue)}`;
  });
  return encodedPairs.join("|");
}

function buildStateMachinesSegmentText(
  stateMachineInspectRows: readonly RuntimeWorldStateMachineInspectRow[],
): string {
  if (stateMachineInspectRows.length === 0) {
    return "-";
  }
  const sortedRows = [...stateMachineInspectRows].sort(compareStateMachineInspectRowsByMachineName);
  const encodedPairs = sortedRows.map((row) => {
    const escapedLeafPath = row.activeLeafPath.replaceAll("|", "\\|").replaceAll("=", "\\=");
    return `${row.machineName}=${escapedLeafPath}`;
  });
  return encodedPairs.join("|");
}

export function buildRuntimeConformanceTraceLineText(params: {
  readonly totalSimulationMilliseconds: number;
  readonly led0IsLightOn: boolean;
  readonly button0IsPressed: boolean;
  readonly displayPresentedFrameFingerprintFnv1a64LowerHex16: string;
  readonly scriptVarSnapshots: readonly RuntimeConformanceScriptVarSnapshot[];
  readonly stateMachineInspectRows: readonly RuntimeWorldStateMachineInspectRow[];
}): string {
  const scriptVarsSegmentText = buildScriptVarsSegmentText(params.scriptVarSnapshots);
  const stateMachinesSegmentText = buildStateMachinesSegmentText(params.stateMachineInspectRows);

  return [
    "trace",
    `schema=${RUNTIME_CONFORMANCE_TRACE_SCHEMA_VERSION}`,
    `sim_ms=${params.totalSimulationMilliseconds}`,
    `led0=${params.led0IsLightOn ? 1 : 0}`,
    `btn0=${params.button0IsPressed ? 1 : 0}`,
    `dpy_fp=${params.displayPresentedFrameFingerprintFnv1a64LowerHex16}`,
    `vars=${scriptVarsSegmentText}`,
    `sm=${stateMachinesSegmentText}`,
  ].join(" ");
}
