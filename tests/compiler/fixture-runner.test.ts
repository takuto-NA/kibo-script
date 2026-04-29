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

  it("compiles serial-print-task.sc without diagnostics", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "serial-print-task.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "serial-print-task.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "serial-print-task.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("compiles circle-animation.sc without diagnostics", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "circle-animation.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "circle-animation.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "circle-animation.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("compiles serial-read-adc.sc without diagnostics", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "serial-read-adc.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "serial-read-adc.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "serial-read-adc.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("compiles button-toggle-on-event.sc without diagnostics", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "button-toggle-on-event.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "button-toggle-on-event.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "button-toggle-on-event.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("compiles match-string-command.sc without diagnostics", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "match-string-command.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "match-string-command.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "match-string-command.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("rejects match-non-string-target.sc with match.target_requires_string", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "match-non-string-target.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "match-non-string-target.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "match-non-string-target.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("rejects match-missing-else.sc with parse diagnostics", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "match-missing-else.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "match-missing-else.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "match-missing-else.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("rejects match-wait-branch.sc with match.branch_unsupported_statement", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "match-wait-branch.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "match-wait-branch.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "match-wait-branch.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("compiles fade-animator-linear.sc without diagnostics", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "fade-animator-linear.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "fade-animator-linear.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "fade-animator-linear.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("compiles fade-animator-ease-in-out.sc without diagnostics", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "fade-animator-ease-in-out.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "fade-animator-ease-in-out.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "fade-animator-ease-in-out.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("rejects fade-animator-unknown.sc with name.unknown_reference", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "fade-animator-unknown.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "fade-animator-unknown.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "fade-animator-unknown.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("rejects fade-animator-invalid-unit.sc with unit.type_mismatch on animator duration", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "fade-animator-invalid-unit.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "fade-animator-invalid-unit.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "fade-animator-invalid-unit.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("rejects fade-animator-invalid-percent.sc with type.percent_literal_out_of_range", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "fade-animator-invalid-percent.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "fade-animator-invalid-percent.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "fade-animator-invalid-percent.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("rejects fade-animator-invalid-ease.sc with type.animator_unsupported_ease", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "fade-animator-invalid-ease.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "fade-animator-invalid-ease.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "fade-animator-invalid-ease.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });

  it("rejects fade-animator-dt-in-event.sc with type.animator_time_expression_invalid_context", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "fade-animator-dt-in-event.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "fade-animator-dt-in-event.sc");
    const expectedPath = join(testsCompilerDirectory, "fixtures", "fade-animator-dt-in-event.expected.json");
    const expectedText = readFileSync(expectedPath, "utf-8");
    const expected = JSON.parse(expectedText) as unknown;
    const actual = serializeCompileScriptResultForGoldenTest(result);
    expect(actual).toEqual(expected);
  });
});
