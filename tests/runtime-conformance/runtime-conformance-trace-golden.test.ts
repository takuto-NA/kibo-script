// 責務: Phase 0 の conformance trace（`SimulationRuntime`）を golden で固定する。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import {
  serializeRuntimeConformanceReplayDocumentToJsonText,
  type RuntimeConformanceReplayStep,
} from "../../src/runtime-conformance/build-runtime-conformance-replay-document";
import { executeTypeScriptConformanceReplayStepsAndCollectTraceLines } from "./helpers/execute-typescript-conformance-replay-steps";
import { maybeWriteTextFileForRuntimeConformanceGoldenUpdate } from "./helpers/maybe-write-runtime-conformance-golden-text-file";

const testsRuntimeConformanceDirectory = dirname(fileURLToPath(import.meta.url));
const compilerFixturesDirectory = join(testsRuntimeConformanceDirectory, "..", "compiler", "fixtures");
const goldenDirectory = join(testsRuntimeConformanceDirectory, "golden");
const replayInputsDirectory = join(testsRuntimeConformanceDirectory, "replay-inputs");

function normalize_line_endings_to_lf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

describe("runtime conformance trace golden tests (TypeScript SimulationRuntime)", () => {
  it("blink-led.sc: tick 1000ms twice toggles led#0 and matches golden trace lines", () => {
    const fixturePath = join(compilerFixturesDirectory, "blink-led.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const compileResult = compileScript(sourceText, "blink-led.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const replaySteps: readonly RuntimeConformanceReplayStep[] = [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 1000 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 1000 },
      { kind: "collect_trace" },
    ];

    const scriptVarNamesToIncludeInTrace: readonly string[] = [];
    const traceLines = executeTypeScriptConformanceReplayStepsAndCollectTraceLines({
      compiledProgram: compileResult.program,
      scriptVarNamesToIncludeInTrace,
      replaySteps,
    });
    const actualTraceText = `${traceLines.join("\n")}\n`;

    const traceGoldenPath = join(goldenDirectory, "blink-led.conformance.trace.txt");
    maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
      absoluteFilePath: traceGoldenPath,
      fileText: actualTraceText,
    });
    const expectedTraceText = normalize_line_endings_to_lf(readFileSync(traceGoldenPath, "utf-8"));
    expect(normalize_line_endings_to_lf(actualTraceText)).toBe(expectedTraceText);

    const replayJsonText = serializeRuntimeConformanceReplayDocumentToJsonText({
      compiledProgram: compileResult.program,
      scriptVarNamesToIncludeInTrace,
      steps: replaySteps,
    });
    const replayJsonPath = join(replayInputsDirectory, "blink-led.replay.json");
    maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
      absoluteFilePath: replayJsonPath,
      fileText: replayJsonText,
    });
    const expectedReplayJsonText = normalize_line_endings_to_lf(readFileSync(replayJsonPath, "utf-8"));
    expect(normalize_line_endings_to_lf(replayJsonText)).toBe(expectedReplayJsonText);
  });

  it("button-toggle-on-event.sc: two pressed events toggle led#0 twice and matches golden trace lines", () => {
    const fixturePath = join(compilerFixturesDirectory, "button-toggle-on-event.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const compileResult = compileScript(sourceText, "button-toggle-on-event.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const replaySteps: readonly RuntimeConformanceReplayStep[] = [
      { kind: "collect_trace" },
      {
        kind: "dispatch_device_event",
        deviceKind: "button",
        deviceId: 0,
        eventName: "pressed",
      },
      { kind: "collect_trace" },
      {
        kind: "dispatch_device_event",
        deviceKind: "button",
        deviceId: 0,
        eventName: "pressed",
      },
      { kind: "collect_trace" },
    ];

    const scriptVarNamesToIncludeInTrace: readonly string[] = [];
    const traceLines = executeTypeScriptConformanceReplayStepsAndCollectTraceLines({
      compiledProgram: compileResult.program,
      scriptVarNamesToIncludeInTrace,
      replaySteps,
    });
    const actualTraceText = `${traceLines.join("\n")}\n`;

    const traceGoldenPath = join(goldenDirectory, "button-toggle-on-event.conformance.trace.txt");
    maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
      absoluteFilePath: traceGoldenPath,
      fileText: actualTraceText,
    });
    const expectedTraceText = normalize_line_endings_to_lf(readFileSync(traceGoldenPath, "utf-8"));
    expect(normalize_line_endings_to_lf(actualTraceText)).toBe(expectedTraceText);

    const replayJsonText = serializeRuntimeConformanceReplayDocumentToJsonText({
      compiledProgram: compileResult.program,
      scriptVarNamesToIncludeInTrace,
      steps: replaySteps,
    });
    const replayJsonPath = join(replayInputsDirectory, "button-toggle-on-event.replay.json");
    maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
      absoluteFilePath: replayJsonPath,
      fileText: replayJsonText,
    });
    const expectedReplayJsonText = normalize_line_endings_to_lf(readFileSync(replayJsonPath, "utf-8"));
    expect(normalize_line_endings_to_lf(replayJsonText)).toBe(expectedReplayJsonText);
  });

  it("circle-animation.sc: every 100ms updates circle_x and presented framebuffer fingerprint", () => {
    const fixturePath = join(compilerFixturesDirectory, "circle-animation.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const compileResult = compileScript(sourceText, "circle-animation.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const replaySteps: readonly RuntimeConformanceReplayStep[] = [
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
      { kind: "tick_ms", elapsedMilliseconds: 100 },
      { kind: "collect_trace" },
    ];

    const scriptVarNamesToIncludeInTrace: readonly string[] = ["circle_x"];
    const traceLines = executeTypeScriptConformanceReplayStepsAndCollectTraceLines({
      compiledProgram: compileResult.program,
      scriptVarNamesToIncludeInTrace,
      replaySteps,
    });
    const actualTraceText = `${traceLines.join("\n")}\n`;

    const traceGoldenPath = join(goldenDirectory, "circle-animation.conformance.trace.txt");
    maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
      absoluteFilePath: traceGoldenPath,
      fileText: actualTraceText,
    });
    const expectedTraceText = normalize_line_endings_to_lf(readFileSync(traceGoldenPath, "utf-8"));
    expect(normalize_line_endings_to_lf(actualTraceText)).toBe(expectedTraceText);

    const replayJsonText = serializeRuntimeConformanceReplayDocumentToJsonText({
      compiledProgram: compileResult.program,
      scriptVarNamesToIncludeInTrace,
      steps: replaySteps,
    });
    const replayJsonPath = join(replayInputsDirectory, "circle-animation.replay.json");
    maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
      absoluteFilePath: replayJsonPath,
      fileText: replayJsonText,
    });
    const expectedReplayJsonText = normalize_line_endings_to_lf(readFileSync(replayJsonPath, "utf-8"));
    expect(normalize_line_endings_to_lf(replayJsonText)).toBe(expectedReplayJsonText);
  });
});
