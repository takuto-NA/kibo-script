// 責務: `ramProbePadding` 付き package が replay 抽出と v1 preflight の境界（12288 / 12289）で期待どおり振る舞うことを固定する。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractReplayInputsFromPicoRuntimePackageUnknownJsonOrThrow } from "../../src/runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract";
import { executeRuntimeConformanceReplayStepsAndCollectTraceLines } from "../../src/runtime-conformance/execute-runtime-conformance-replay-steps-and-collect-trace-lines";
import {
  assessKiboPicoRuntimePackageJsonTextPreflightForDeviceProtocolV1WebSerialOrThrow,
  KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES,
} from "../../src/runtime-conformance/kibo-pico-package-preflight";
import {
  buildMinifiedUtf8BytesWithRamProbePaddingTargetLengthOrThrow,
  KIBO_PICO_RUNTIME_PACKAGE_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME,
} from "../../src/runtime-conformance/pico-runtime-package-ram-probe-padding";

const tests_directory = dirname(fileURLToPath(import.meta.url));

describe("pico-runtime-package ramProbePadding", () => {
  it("extractReplayInputs ignores ramProbePadding and matches unpadded replay shape", () => {
    const golden_path = join(tests_directory, "golden", "pico-runtime-packages", "blink-led.pico-runtime-package.json");
    const template_root = JSON.parse(readFileSync(golden_path, "utf-8")) as unknown;
    const unpadded = extractReplayInputsFromPicoRuntimePackageUnknownJsonOrThrow(template_root);

    const padded_bytes = buildMinifiedUtf8BytesWithRamProbePaddingTargetLengthOrThrow({
      templatePackageRoot: template_root,
      targetMinifiedUtf8ByteCount: Math.min(6000, KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES - 1),
    });
    const padded_text = new TextDecoder("utf-8").decode(padded_bytes);
    const padded_root = JSON.parse(padded_text) as unknown;
    const padded = extractReplayInputsFromPicoRuntimePackageUnknownJsonOrThrow(padded_root);

    expect(JSON.stringify(padded.replaySteps)).toBe(JSON.stringify(unpadded.replaySteps));
    expect(padded_root).toHaveProperty(KIBO_PICO_RUNTIME_PACKAGE_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME);
  });

  it("v1 preflight allows 12288 bytes and rejects 12289", () => {
    const golden_path = join(tests_directory, "golden", "pico-runtime-packages", "blink-led.pico-runtime-package.json");
    const template_root = JSON.parse(readFileSync(golden_path, "utf-8")) as unknown;

    const exact_limit_bytes = buildMinifiedUtf8BytesWithRamProbePaddingTargetLengthOrThrow({
      templatePackageRoot: template_root,
      targetMinifiedUtf8ByteCount: KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES,
    });
    const exact_text = new TextDecoder("utf-8").decode(exact_limit_bytes);
    const exact_result = assessKiboPicoRuntimePackageJsonTextPreflightForDeviceProtocolV1WebSerialOrThrow({
      canonicalPicoRuntimePackageJsonText: exact_text,
    });
    expect(exact_result.severity).not.toBe("reject");
    expect(exact_result.minifiedUtf8ByteCount).toBe(KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES);

    const over = buildMinifiedUtf8BytesWithRamProbePaddingTargetLengthOrThrow({
      templatePackageRoot: template_root,
      targetMinifiedUtf8ByteCount: KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES,
    });
    const over_object = JSON.parse(new TextDecoder("utf-8").decode(over)) as Record<string, unknown>;
    over_object[KIBO_PICO_RUNTIME_PACKAGE_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME] = `${String(
      over_object[KIBO_PICO_RUNTIME_PACKAGE_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME],
    )}x`;
    const over_text = JSON.stringify(over_object);
    const over_result = assessKiboPicoRuntimePackageJsonTextPreflightForDeviceProtocolV1WebSerialOrThrow({
      canonicalPicoRuntimePackageJsonText: over_text,
    });
    expect(over_result.severity).toBe("reject");
    expect(over_result.minifiedUtf8ByteCount).toBeGreaterThan(KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES);
  });

  it("padded package produces same TypeScript conformance replay trace lines as unpadded template", () => {
    const golden_path = join(tests_directory, "golden", "pico-runtime-packages", "blink-led.pico-runtime-package.json");
    const template_root = JSON.parse(readFileSync(golden_path, "utf-8")) as unknown;
    const unpadded_inputs = extractReplayInputsFromPicoRuntimePackageUnknownJsonOrThrow(template_root);
    const unpadded_traces = executeRuntimeConformanceReplayStepsAndCollectTraceLines({
      compiledProgram: unpadded_inputs.compiledProgram,
      scriptVarNamesToIncludeInTrace: unpadded_inputs.scriptVarNamesToIncludeInTrace,
      replaySteps: unpadded_inputs.replaySteps,
    });

    const padded_bytes = buildMinifiedUtf8BytesWithRamProbePaddingTargetLengthOrThrow({
      templatePackageRoot: template_root,
      targetMinifiedUtf8ByteCount: Math.min(6000, KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES - 1),
    });
    const padded_root = JSON.parse(new TextDecoder("utf-8").decode(padded_bytes)) as unknown;
    const padded_inputs = extractReplayInputsFromPicoRuntimePackageUnknownJsonOrThrow(padded_root);
    const padded_traces = executeRuntimeConformanceReplayStepsAndCollectTraceLines({
      compiledProgram: padded_inputs.compiledProgram,
      scriptVarNamesToIncludeInTrace: padded_inputs.scriptVarNamesToIncludeInTrace,
      replaySteps: padded_inputs.replaySteps,
    });

    expect(padded_traces).toEqual(unpadded_traces);
  });
});
