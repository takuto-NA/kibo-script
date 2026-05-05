// 責務: `kibo-pico-package-preflight` が golden package に対して期待どおりの severity を返すことを固定する。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assessKiboPicoRuntimePackageJsonTextPreflightOrThrow } from "../../src/runtime-conformance/kibo-pico-package-preflight";

const tests_directory = dirname(fileURLToPath(import.meta.url));

describe("kibo-pico-package-preflight", () => {
  it("blink-led golden package is below warn threshold (ok)", () => {
    const path = join(tests_directory, "golden", "pico-runtime-packages", "blink-led.pico-runtime-package.json");
    const text = readFileSync(path, "utf-8");
    const result = assessKiboPicoRuntimePackageJsonTextPreflightOrThrow({
      canonicalPicoRuntimePackageJsonText: text,
    });
    expect(result.severity).toBe("ok");
  });

  it("rejects minified UTF-8 payload above firmware decode limit", () => {
    const oversized_object = { filler: "y".repeat(15000) };
    const canonical_text = JSON.stringify(oversized_object);
    const result = assessKiboPicoRuntimePackageJsonTextPreflightOrThrow({
      canonicalPicoRuntimePackageJsonText: canonical_text,
    });
    expect(result.severity).toBe("reject");
    expect(result.messages.some((message) => message.includes("package_too_large"))).toBe(true);
  });
});
