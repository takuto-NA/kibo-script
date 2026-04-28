import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScript } from "../../src/compiler/compile-script";
import { serializeCompileScriptResultForGoldenTest } from "./serialize-compiler-output";

const testsCompilerDirectory = dirname(fileURLToPath(import.meta.url));

describe("compiler fixture golden tests", () => {
  it("compiles blink-led.sc without diagnostics", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "blink-led.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "blink-led.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "blink-led.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("rejects invalid-unit.sc with unit.type_mismatch on interval", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "invalid-unit.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "invalid-unit.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "invalid-unit.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });
});
