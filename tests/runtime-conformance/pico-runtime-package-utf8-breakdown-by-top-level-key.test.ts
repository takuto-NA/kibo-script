// 責務: minify 後の `PicoRuntimePackage` で `runtimeIrContract` が他トップレベルキーより支配的であることを代表サンプルで固定する（package 肥大の第一原因の回帰防止）。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow } from "../../src/runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract";
import { breakDownMinifiedPicoRuntimePackageUtf8ByTopLevelKeysOrThrow } from "../../src/runtime-conformance/break-down-minified-pico-runtime-package-utf8-by-top-level-keys";

const testsRuntimeConformanceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRootDirectory = join(testsRuntimeConformanceDirectory, "..", "..");
const samplesDirectory = join(repositoryRootDirectory, "examples", "pico-runtime-samples");

function buildPackageTextForSampleOrThrow(params: {
  readonly sourceFile: string;
  readonly traceVars: readonly string[];
}): string {
  const sourcePath = join(samplesDirectory, params.sourceFile);
  const sourceText = readFileSync(sourcePath, "utf-8").replace(/\r\n/g, "\n");
  const compileResult = compileScript(sourceText, params.sourceFile);
  expect(compileResult.ok).toBe(true);
  if (compileResult.ok === false) {
    throw new Error("compile failed");
  }
  return buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow({
    compiledProgram: compileResult.program,
    scriptVarNamesToIncludeInTraceOverride: params.traceVars,
  });
}

function findRowByteCountOrThrow(params: {
  readonly rows: readonly { readonly topLevelJsonKey: string; readonly minifiedUtf8ByteCountForValueSubtree: number }[];
  readonly topLevelJsonKey: string;
}): number {
  const row = params.rows.find((candidate) => candidate.topLevelJsonKey === params.topLevelJsonKey);
  if (row === undefined) {
    throw new Error(`Missing breakdown row for key ${params.topLevelJsonKey}.`);
  }
  return row.minifiedUtf8ByteCountForValueSubtree;
}

describe("PicoRuntimePackage UTF-8 breakdown by top-level key", () => {
  it("radio-state-tuner: runtimeIrContract subtree dominates replay and traceObservation", () => {
    const packageText = buildPackageTextForSampleOrThrow({
      sourceFile: "radio-state-tuner.sc",
      traceVars: ["band", "label"],
    });
    const breakdown = breakDownMinifiedPicoRuntimePackageUtf8ByTopLevelKeysOrThrow({
      canonicalPicoRuntimePackageJsonText: packageText,
    });
    const runtimeIrBytes = findRowByteCountOrThrow({
      rows: breakdown.rowsSortedByByteCountDescending,
      topLevelJsonKey: "runtimeIrContract",
    });
    const replayBytes = findRowByteCountOrThrow({
      rows: breakdown.rowsSortedByByteCountDescending,
      topLevelJsonKey: "replay",
    });
    const traceObservationBytes = findRowByteCountOrThrow({
      rows: breakdown.rowsSortedByByteCountDescending,
      topLevelJsonKey: "traceObservation",
    });
    expect(runtimeIrBytes).toBeGreaterThan(replayBytes * 2);
    expect(runtimeIrBytes).toBeGreaterThan(traceObservationBytes * 10);
  });

  it("sensor-alert-dashboard: runtimeIrContract subtree is largest top-level value", () => {
    const packageText = buildPackageTextForSampleOrThrow({
      sourceFile: "sensor-alert-dashboard.sc",
      traceVars: ["sensor_raw", "alert_level", "alert_count"],
    });
    const breakdown = breakDownMinifiedPicoRuntimePackageUtf8ByTopLevelKeysOrThrow({
      canonicalPicoRuntimePackageJsonText: packageText,
    });
    const largest = breakdown.rowsSortedByByteCountDescending[0];
    expect(largest).toBeDefined();
    if (largest === undefined) {
      return;
    }
    expect(largest.topLevelJsonKey).toBe("runtimeIrContract");
  });
});
