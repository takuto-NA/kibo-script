// 責務: MVP 用 `PicoRuntimePackage` の JSON が fixture ごとに決定的であることを golden で固定する。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { serializePicoRuntimePackageToCanonicalJsonTextForMvpProfile } from "../../src/runtime-conformance/build-pico-runtime-package";
import { maybeWriteTextFileForRuntimeConformanceGoldenUpdate } from "./helpers/maybe-write-runtime-conformance-golden-text-file";

const tests_runtime_conformance_directory = dirname(fileURLToPath(import.meta.url));
const compiler_fixtures_directory = join(tests_runtime_conformance_directory, "..", "compiler", "fixtures");
const golden_directory = join(tests_runtime_conformance_directory, "golden", "pico-runtime-packages");

function normalize_line_endings_to_lf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

describe("Pico runtime package golden tests", () => {
  it("matches golden for blink-led.sc", () => {
    const fixture_path = join(compiler_fixtures_directory, "blink-led.sc");
    const source_text = readFileSync(fixture_path, "utf-8").replace(/\r\n/g, "\n");
    const compile_result = compileScript(source_text, "blink-led.sc");
    expect(compile_result.ok).toBe(true);
    if (compile_result.ok === false) {
      return;
    }

    const actual_text = serializePicoRuntimePackageToCanonicalJsonTextForMvpProfile({
      compiledProgram: compile_result.program,
      profileName: "blink-led",
    });
    const golden_path = join(golden_directory, "blink-led.pico-runtime-package.json");
    maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
      absoluteFilePath: golden_path,
      fileText: actual_text,
    });
    const expected_text = normalize_line_endings_to_lf(readFileSync(golden_path, "utf-8"));
    expect(normalize_line_endings_to_lf(actual_text)).toBe(expected_text);
  });

  it("matches golden for button-toggle-on-event.sc", () => {
    const fixture_path = join(compiler_fixtures_directory, "button-toggle-on-event.sc");
    const source_text = readFileSync(fixture_path, "utf-8").replace(/\r\n/g, "\n");
    const compile_result = compileScript(source_text, "button-toggle-on-event.sc");
    expect(compile_result.ok).toBe(true);
    if (compile_result.ok === false) {
      return;
    }

    const actual_text = serializePicoRuntimePackageToCanonicalJsonTextForMvpProfile({
      compiledProgram: compile_result.program,
      profileName: "button-toggle-on-event",
    });
    const golden_path = join(golden_directory, "button-toggle-on-event.pico-runtime-package.json");
    maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
      absoluteFilePath: golden_path,
      fileText: actual_text,
    });
    const expected_text = normalize_line_endings_to_lf(readFileSync(golden_path, "utf-8"));
    expect(normalize_line_endings_to_lf(actual_text)).toBe(expected_text);
  });

  it("matches golden for circle-animation.sc", () => {
    const fixture_path = join(compiler_fixtures_directory, "circle-animation.sc");
    const source_text = readFileSync(fixture_path, "utf-8").replace(/\r\n/g, "\n");
    const compile_result = compileScript(source_text, "circle-animation.sc");
    expect(compile_result.ok).toBe(true);
    if (compile_result.ok === false) {
      return;
    }

    const actual_text = serializePicoRuntimePackageToCanonicalJsonTextForMvpProfile({
      compiledProgram: compile_result.program,
      profileName: "circle-animation",
    });
    const golden_path = join(golden_directory, "circle-animation.pico-runtime-package.json");
    maybeWriteTextFileForRuntimeConformanceGoldenUpdate({
      absoluteFilePath: golden_path,
      fileText: actual_text,
    });
    const expected_text = normalize_line_endings_to_lf(readFileSync(golden_path, "utf-8"));
    expect(normalize_line_endings_to_lf(actual_text)).toBe(expected_text);
  });
});
