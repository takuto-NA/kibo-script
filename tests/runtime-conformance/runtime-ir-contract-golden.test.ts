// 責務: runtime IR contract（versioned JSON）が fixture ごとに決定的であることを golden で固定する。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { serializeCompiledProgramToRuntimeIrContractJsonText } from "../../src/runtime-conformance/serialize-compiled-program-to-runtime-ir-contract-json-text";
import { maybeWriteTextFileForRuntimeConformanceGoldenUpdate } from "./helpers/maybe-write-runtime-conformance-golden-text-file";

const testsRuntimeConformanceDirectory = dirname(fileURLToPath(import.meta.url));
const compilerFixturesDirectory = join(testsRuntimeConformanceDirectory, "..", "compiler", "fixtures");
const goldenDirectory = join(testsRuntimeConformanceDirectory, "golden");

describe("runtime IR contract golden tests", () => {
  it("matches golden for blink-led.sc", () => {
    const fixturePath = join(compilerFixturesDirectory, "blink-led.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const compileResult = compileScript(sourceText, "blink-led.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const actualText = serializeCompiledProgramToRuntimeIrContractJsonText(compileResult.program);
    const goldenPath = join(goldenDirectory, "blink-led.runtime-ir-contract.json");
    maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
      absoluteFilePath: goldenPath,
      fileText: actualText,
    });
    const expectedText = readFileSync(goldenPath, "utf-8");
    expect(actualText).toBe(expectedText);
  });

  it("matches golden for button-toggle-on-event.sc", () => {
    const fixturePath = join(compilerFixturesDirectory, "button-toggle-on-event.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const compileResult = compileScript(sourceText, "button-toggle-on-event.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const actualText = serializeCompiledProgramToRuntimeIrContractJsonText(compileResult.program);
    const goldenPath = join(goldenDirectory, "button-toggle-on-event.runtime-ir-contract.json");
    maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
      absoluteFilePath: goldenPath,
      fileText: actualText,
    });
    const expectedText = readFileSync(goldenPath, "utf-8");
    expect(actualText).toBe(expectedText);
  });

  it("matches golden for circle-animation.sc", () => {
    const fixturePath = join(compilerFixturesDirectory, "circle-animation.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const compileResult = compileScript(sourceText, "circle-animation.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const actualText = serializeCompiledProgramToRuntimeIrContractJsonText(compileResult.program);
    const goldenPath = join(goldenDirectory, "circle-animation.runtime-ir-contract.json");
    maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
      absoluteFilePath: goldenPath,
      fileText: actualText,
    });
    const expectedText = readFileSync(goldenPath, "utf-8");
    expect(actualText).toBe(expectedText);
  });
});
