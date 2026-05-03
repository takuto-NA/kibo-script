// 責務: TypeScript `SimulationRuntime` と C++ host runtime が同じ入力列で trace を比較するための replay ドキュメントを組み立てる。
//
// 注意:
// - `replaySchemaVersion` と `steps` の意味は `docs/runtime-conformance.md` を正とする。

import type { CompiledProgram } from "../core/executable-task";
import {
  RUNTIME_IR_CONTRACT_SCHEMA_VERSION,
  sortJsonCompatibleValueByKeysDeep,
} from "./serialize-compiled-program-to-runtime-ir-contract-json-text";

export const RUNTIME_CONFORMANCE_REPLAY_SCHEMA_VERSION = 1 as const;

export type RuntimeConformanceReplayStep =
  | { kind: "collect_trace" }
  | { kind: "tick_ms"; elapsedMilliseconds: number }
  | { kind: "dispatch_device_event"; deviceKind: string; deviceId: number; eventName: string };

export function serializeRuntimeConformanceReplayDocumentToJsonText(params: {
  readonly compiledProgram: CompiledProgram;
  readonly scriptVarNamesToIncludeInTrace: readonly string[];
  readonly steps: readonly RuntimeConformanceReplayStep[];
}): string {
  const sortedScriptVarNames = [...params.scriptVarNamesToIncludeInTrace].sort((left, right) =>
    left.localeCompare(right),
  );
  const replayRoot = {
    replaySchemaVersion: RUNTIME_CONFORMANCE_REPLAY_SCHEMA_VERSION,
    runtimeIrContract: {
      runtimeIrContractSchemaVersion: RUNTIME_IR_CONTRACT_SCHEMA_VERSION,
      compiledProgram: params.compiledProgram,
    },
    traceObservation: {
      scriptVarNamesToIncludeInTrace: sortedScriptVarNames,
    },
    steps: params.steps,
  };
  const canonicalReplayRoot = sortJsonCompatibleValueByKeysDeep(replayRoot) as Record<string, unknown>;
  return `${JSON.stringify(canonicalReplayRoot, undefined, 2)}\n`;
}
