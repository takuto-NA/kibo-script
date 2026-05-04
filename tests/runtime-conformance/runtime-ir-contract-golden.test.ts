// 責務: runtime IR contract（versioned JSON）が fixture ごとに決定的であることを golden で固定する。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { serializeCompiledProgramToRuntimeIrContractJsonText } from "../../src/runtime-conformance/serialize-compiled-program-to-runtime-ir-contract-json-text";
import { maybeWriteTextFileForRuntimeConformanceGoldenUpdate } from "./helpers/maybe-write-runtime-conformance-golden-text-file";
import { RUNTIME_CONFORMANCE_FIXTURE_CASE_DEFINITIONS } from "./runtime-conformance-fixture-cases";

const testsRuntimeConformanceDirectory = dirname(fileURLToPath(import.meta.url));
const compilerFixturesDirectory = join(testsRuntimeConformanceDirectory, "..", "compiler", "fixtures");
const goldenDirectory = join(testsRuntimeConformanceDirectory, "golden");

function normalize_line_endings_to_lf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

describe("runtime IR contract golden tests", () => {
  for (const fixtureCase of RUNTIME_CONFORMANCE_FIXTURE_CASE_DEFINITIONS) {
    it(`matches golden for ${fixtureCase.fixtureSourceFileName}`, () => {
      const fixturePath = join(compilerFixturesDirectory, fixtureCase.fixtureSourceFileName);
      const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
      const compileResult = compileScript(sourceText, fixtureCase.fixtureSourceFileName);
      expect(compileResult.ok).toBe(true);
      if (compileResult.ok === false) {
        return;
      }

      const actualText = serializeCompiledProgramToRuntimeIrContractJsonText(compileResult.program);
      const goldenPath = join(goldenDirectory, `${fixtureCase.goldenBaseName}.runtime-ir-contract.json`);
      maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
        absoluteFilePath: goldenPath,
        fileText: actualText,
      });
      const expectedText = normalize_line_endings_to_lf(readFileSync(goldenPath, "utf-8"));
      expect(normalize_line_endings_to_lf(actualText)).toBe(expectedText);
    });
  }
});
