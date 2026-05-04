// 責務: simulator export 相当の runtime IR contract golden から `PicoRuntimePackage` golden への推定変換が、既存 MVP golden と一致することを検証する。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPicoRuntimePackageCanonicalJsonTextFromRuntimeIrContractJsonTextOrThrow } from "../../src/runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract";

const tests_runtime_conformance_directory = dirname(fileURLToPath(import.meta.url));
const golden_directory = join(tests_runtime_conformance_directory, "golden");
const golden_pico_package_directory = join(golden_directory, "pico-runtime-packages");

function normalize_line_endings_to_lf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

describe("Runtime IR contract -> PicoRuntimePackage golden parity", () => {
  it.each([
    { fixtureBaseName: "blink-led" },
    { fixtureBaseName: "button-toggle-on-event" },
    { fixtureBaseName: "circle-animation" },
  ] as const)("matches golden package for $fixtureBaseName", ({ fixtureBaseName }) => {
    const runtime_ir_path = join(golden_directory, `${fixtureBaseName}.runtime-ir-contract.json`);
    const expected_package_path = join(golden_pico_package_directory, `${fixtureBaseName}.pico-runtime-package.json`);

    const runtime_ir_text = readFileSync(runtime_ir_path, "utf-8");
    const actual_text = buildPicoRuntimePackageCanonicalJsonTextFromRuntimeIrContractJsonTextOrThrow({
      runtimeIrContractJsonText: runtime_ir_text,
      scriptVarNamesToIncludeInTraceOverride: undefined,
    });
    const expected_text = normalize_line_endings_to_lf(readFileSync(expected_package_path, "utf-8"));
    expect(normalize_line_endings_to_lf(actual_text)).toBe(expected_text);
  });
});
