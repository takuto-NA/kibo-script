// 責務: `SimulationRuntime` 上で replay steps を実行し、collect_trace ごとの trace 行を返す（TypeScript conformance harness）。

import type { DeviceAddress } from "../../../src/core/device-address";
import type { CompiledProgram } from "../../../src/core/executable-task";
import { SimulationRuntime } from "../../../src/core/simulation-runtime";
import { TaskRegistry } from "../../../src/core/task-registry";
import { collectRuntimeConformanceTraceLineTextFromSimulationRuntime } from "../../../src/runtime-conformance/collect-runtime-conformance-snapshot-from-simulation-runtime";
import type { RuntimeConformanceReplayStep } from "../../../src/runtime-conformance/build-runtime-conformance-replay-document";

function parseDeviceKindToDeviceAddressOrThrow(params: {
  readonly deviceKind: string;
  readonly deviceId: number;
}): DeviceAddress {
  if (params.deviceKind === "button") {
    return { kind: "button", id: params.deviceId };
  }
  if (params.deviceKind === "led") {
    return { kind: "led", id: params.deviceId };
  }
  if (params.deviceKind === "display") {
    return { kind: "display", id: params.deviceId };
  }
  throw new Error(`Unsupported deviceKind for conformance replay: ${params.deviceKind}`);
}

export function executeTypeScriptConformanceReplayStepsAndCollectTraceLines(params: {
  readonly compiledProgram: CompiledProgram;
  readonly scriptVarNamesToIncludeInTrace: readonly string[];
  readonly replaySteps: readonly RuntimeConformanceReplayStep[];
}): readonly string[] {
  const simulationRuntime = new SimulationRuntime({ tasks: new TaskRegistry() });
  simulationRuntime.replaceCompiledProgram(params.compiledProgram);

  const traceLines: string[] = [];
  for (const replayStep of params.replaySteps) {
    if (replayStep.kind === "collect_trace") {
      const traceLine = collectRuntimeConformanceTraceLineTextFromSimulationRuntime({
        simulationRuntime,
        scriptVarNamesToInclude: params.scriptVarNamesToIncludeInTrace,
      });
      traceLines.push(traceLine);
      continue;
    }
    if (replayStep.kind === "tick_ms") {
      simulationRuntime.tick(replayStep.elapsedMilliseconds);
      continue;
    }
    if (replayStep.kind === "dispatch_device_event") {
      const deviceAddress = parseDeviceKindToDeviceAddressOrThrow({
        deviceKind: replayStep.deviceKind,
        deviceId: replayStep.deviceId,
      });
      simulationRuntime.dispatchScriptEvent({
        deviceAddress,
        eventName: replayStep.eventName,
      });
      continue;
    }

    const exhaustiveCheck: never = replayStep;
    throw new Error(`Unhandled replay step: ${JSON.stringify(exhaustiveCheck)}`);
  }

  return traceLines;
}
