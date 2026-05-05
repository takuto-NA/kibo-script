// 責務: `examples/pico-runtime-samples` の全 script が simulator で compile / replay でき、Pico package 化できることを固定する。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import {
  buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow,
  extractReplayInputsFromPicoRuntimePackageUnknownJsonOrThrow,
} from "../../src/runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract";
import { executeRuntimeConformanceReplayStepsAndCollectTraceLines } from "../../src/runtime-conformance/execute-runtime-conformance-replay-steps-and-collect-trace-lines";
import {
  assessKiboPicoRuntimePackageJsonTextPreflightOrThrow,
  KIBO_PICO_PACKAGE_PREFLIGHT_WARN_MINIFIED_BYTE_FRACTION_OF_DECODE_LIMIT,
  KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES,
} from "../../src/runtime-conformance/kibo-pico-package-preflight";

type SampleManifest = {
  readonly samples: readonly {
    readonly name: string;
    readonly sourceFile: string;
    readonly traceVars: readonly string[];
  }[];
};

const testsRuntimeConformanceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRootDirectory = join(testsRuntimeConformanceDirectory, "..", "..");
const samplesDirectory = join(repositoryRootDirectory, "examples", "pico-runtime-samples");
const samplesManifest = JSON.parse(
  readFileSync(join(samplesDirectory, "samples.json"), "utf-8"),
) as SampleManifest;

describe("Pico runtime sample scripts", () => {
  it.each(samplesManifest.samples)("compiles, packages, and replays $name", (sample) => {
    const sourcePath = join(samplesDirectory, sample.sourceFile);
    const sourceText = readFileSync(sourcePath, "utf-8").replace(/\r\n/g, "\n");
    const compileResult = compileScript(sourceText, sample.sourceFile);
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const packageText = buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow({
      compiledProgram: compileResult.program,
      scriptVarNamesToIncludeInTraceOverride: sample.traceVars,
    });
    const preflight_assessment = assessKiboPicoRuntimePackageJsonTextPreflightOrThrow({
      canonicalPicoRuntimePackageJsonText: packageText,
    });
    // マニフェスト sample は decode 上限の warn 閾値（80%）未満を維持し severity は ok のみとする（warn は bytecode 着手の合図のため実験用に限定）。
    const warn_threshold_minified_utf8_bytes = Math.floor(
      KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES *
        KIBO_PICO_PACKAGE_PREFLIGHT_WARN_MINIFIED_BYTE_FRACTION_OF_DECODE_LIMIT,
    );
    expect(preflight_assessment.minifiedUtf8ByteCount).toBeLessThan(warn_threshold_minified_utf8_bytes);
    expect(preflight_assessment.severity).toBe("ok");
    const replayInputs = extractReplayInputsFromPicoRuntimePackageUnknownJsonOrThrow(JSON.parse(packageText));
    const traceLines = executeRuntimeConformanceReplayStepsAndCollectTraceLines({
      compiledProgram: replayInputs.compiledProgram,
      scriptVarNamesToIncludeInTrace: replayInputs.scriptVarNamesToIncludeInTrace,
      replaySteps: replayInputs.replaySteps,
    });

    expect(traceLines.length).toBeGreaterThanOrEqual(3);
    expect(traceLines.every((line) => line.startsWith("trace schema=1 "))).toBe(true);
  });
});
