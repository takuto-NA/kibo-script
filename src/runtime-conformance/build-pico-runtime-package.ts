// 責務: Pico へ USB Serial で送る開発用 `PicoRuntimePackage`（runtime IR + replay + trace 観測 + live tick）を組み立て、決定的な JSON テキストへ直列化する。
//
// 注意:
// - `replay.steps` の意味は `docs/runtime-conformance.md` の replay schema v1 と同一である。
// - オブジェクトキーは辞書順に並べ替え、浮動小数は使わない前提で出力を安定化する。

import type { CompiledProgram } from "../core/executable-task";
import {
  RUNTIME_IR_CONTRACT_SCHEMA_VERSION,
  serializeCompiledProgramToRuntimeIrContractJsonText,
  sortJsonCompatibleValueByKeysDeep,
} from "./serialize-compiled-program-to-runtime-ir-contract-json-text";
import type { RuntimeConformanceReplayStep } from "./build-runtime-conformance-replay-document";

export const PICO_RUNTIME_PACKAGE_SCHEMA_VERSION = 1 as const;

export type PicoRuntimePackageMvpProfileName =
  | "blink-led"
  | "button-toggle-on-event"
  | "circle-animation";

const LIVE_TICK_INTERVAL_MILLISECONDS_BY_MVP_PROFILE: Readonly<
  Record<PicoRuntimePackageMvpProfileName, number>
> = {
  "blink-led": 1000,
  "button-toggle-on-event": 100,
  "circle-animation": 100,
};

export function resolveLiveTickIntervalMillisecondsForMvpProfile(
  profileName: PicoRuntimePackageMvpProfileName,
): number {
  return LIVE_TICK_INTERVAL_MILLISECONDS_BY_MVP_PROFILE[profileName];
}

export function buildReplayStepsForMvpProfileOrThrow(
  profileName: PicoRuntimePackageMvpProfileName,
): readonly RuntimeConformanceReplayStep[] {
  if (profileName === "blink-led") {
    return [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 1000 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 1000 },
      { kind: "collect_trace" },
    ];
  }
  if (profileName === "button-toggle-on-event") {
    return [
      { kind: "collect_trace" },
      { kind: "dispatch_device_event", deviceKind: "button", deviceId: 0, eventName: "pressed" },
      { kind: "collect_trace" },
      { kind: "dispatch_device_event", deviceKind: "button", deviceId: 0, eventName: "pressed" },
      { kind: "collect_trace" },
    ];
  }
  if (profileName === "circle-animation") {
    return [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
    ];
  }
  const exhaustiveCheck: never = profileName;
  throw new Error(`Unhandled MVP profile: ${String(exhaustiveCheck)}`);
}

export function resolveScriptVarNamesToIncludeInTraceForMvpProfile(
  profileName: PicoRuntimePackageMvpProfileName,
): readonly string[] {
  if (profileName === "circle-animation") {
    return ["circle_x"];
  }
  return [];
}

export function serializePicoRuntimePackageToCanonicalJsonText(params: {
  readonly compiledProgram: CompiledProgram;
  readonly replaySteps: readonly RuntimeConformanceReplayStep[];
  readonly scriptVarNamesToIncludeInTrace: readonly string[];
  readonly liveTickIntervalMilliseconds: number;
}): string {
  const runtime_ir_contract_text = serializeCompiledProgramToRuntimeIrContractJsonText(params.compiledProgram);
  const runtime_ir_contract = JSON.parse(runtime_ir_contract_text) as Record<string, unknown>;

  if (runtime_ir_contract.runtimeIrContractSchemaVersion !== RUNTIME_IR_CONTRACT_SCHEMA_VERSION) {
    throw new Error("Unexpected runtimeIrContractSchemaVersion after parsing serialized runtime IR contract.");
  }

  const sorted_script_var_names = [...params.scriptVarNamesToIncludeInTrace].sort((left, right) =>
    left.localeCompare(right),
  );

  const package_root = {
    live: {
      tickIntervalMilliseconds: params.liveTickIntervalMilliseconds,
    },
    packageSchemaVersion: PICO_RUNTIME_PACKAGE_SCHEMA_VERSION,
    replay: {
      steps: params.replaySteps,
    },
    runtimeIrContract: runtime_ir_contract,
    traceObservation: {
      scriptVarNamesToIncludeInTrace: sorted_script_var_names,
    },
  };

  const canonical_package_root = sortJsonCompatibleValueByKeysDeep(package_root) as Record<string, unknown>;
  return `${JSON.stringify(canonical_package_root, undefined, 2)}\n`;
}

export function serializePicoRuntimePackageToCanonicalJsonTextForMvpProfile(params: {
  readonly compiledProgram: CompiledProgram;
  readonly profileName: PicoRuntimePackageMvpProfileName;
}): string {
  const replay_steps = buildReplayStepsForMvpProfileOrThrow(params.profileName);
  const script_var_names = resolveScriptVarNamesToIncludeInTraceForMvpProfile(params.profileName);
  const live_tick_interval_milliseconds = resolveLiveTickIntervalMillisecondsForMvpProfile(params.profileName);
  return serializePicoRuntimePackageToCanonicalJsonText({
    compiledProgram: params.compiledProgram,
    replaySteps: replay_steps,
    scriptVarNamesToIncludeInTrace: script_var_names,
    liveTickIntervalMilliseconds: live_tick_interval_milliseconds,
  });
}
