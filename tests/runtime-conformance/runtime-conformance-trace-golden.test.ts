// 責務: Phase 0 の conformance trace（`SimulationRuntime`）を golden で固定する。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { serializeRuntimeConformanceReplayDocumentToJsonText } from "../../src/runtime-conformance/build-runtime-conformance-replay-document";
import { executeTypeScriptConformanceReplayStepsAndCollectTraceLines } from "./helpers/execute-typescript-conformance-replay-steps";
import { maybeWriteTextFileForRuntimeConformanceGoldenUpdate } from "./helpers/maybe-write-runtime-conformance-golden-text-file";
import { RUNTIME_CONFORMANCE_FIXTURE_CASE_DEFINITIONS } from "./runtime-conformance-fixture-cases";

const testsRuntimeConformanceDirectory = dirname(fileURLToPath(import.meta.url));
const compilerFixturesDirectory = join(testsRuntimeConformanceDirectory, "..", "compiler", "fixtures");
const goldenDirectory = join(testsRuntimeConformanceDirectory, "golden");
const replayInputsDirectory = join(testsRuntimeConformanceDirectory, "replay-inputs");

function normalize_line_endings_to_lf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

describe("runtime conformance trace golden tests (TypeScript SimulationRuntime)", () => {
  for (const fixtureCase of RUNTIME_CONFORMANCE_FIXTURE_CASE_DEFINITIONS) {
    it(`${fixtureCase.fixtureSourceFileName}: replay steps match golden trace lines`, () => {
      const fixturePath = join(compilerFixturesDirectory, fixtureCase.fixtureSourceFileName);
      const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
      const compileResult = compileScript(sourceText, fixtureCase.fixtureSourceFileName);
      expect(compileResult.ok).toBe(true);
      if (compileResult.ok === false) {
        return;
      }

      const traceLines = executeTypeScriptConformanceReplayStepsAndCollectTraceLines({
        compiledProgram: compileResult.program,
        scriptVarNamesToIncludeInTrace: fixtureCase.scriptVarNamesToIncludeInTrace,
        replaySteps: fixtureCase.replaySteps,
      });
      const actualTraceText = `${traceLines.join("\n")}\n`;

      const traceGoldenPath = join(goldenDirectory, `${fixtureCase.goldenBaseName}.conformance.trace.txt`);
      maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
        absoluteFilePath: traceGoldenPath,
        fileText: actualTraceText,
      });
      const expectedTraceText = normalize_line_endings_to_lf(readFileSync(traceGoldenPath, "utf-8"));
      expect(normalize_line_endings_to_lf(actualTraceText)).toBe(expectedTraceText);

      const replayJsonText = serializeRuntimeConformanceReplayDocumentToJsonText({
        compiledProgram: compileResult.program,
        scriptVarNamesToIncludeInTrace: fixtureCase.scriptVarNamesToIncludeInTrace,
        steps: fixtureCase.replaySteps,
      });
      const replayJsonPath = join(replayInputsDirectory, `${fixtureCase.goldenBaseName}.replay.json`);
      maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
        absoluteFilePath: replayJsonPath,
        fileText: replayJsonText,
      });
      const expectedReplayJsonText = normalize_line_endings_to_lf(readFileSync(replayJsonPath, "utf-8"));
      expect(normalize_line_endings_to_lf(replayJsonText)).toBe(expectedReplayJsonText);
    });
  }
});
