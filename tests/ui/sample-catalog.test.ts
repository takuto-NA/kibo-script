/**
 * 責務: `sample-catalog` がマニフェストとバンドル済み `.sc` を矛盾なく突き合わせていることを検証する。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PICO_RUNTIME_SAMPLE_CATALOG_ENTRIES } from "../../src/ui/sample-catalog";

const tests_ui_directory = dirname(fileURLToPath(import.meta.url));
const repository_root_directory = join(tests_ui_directory, "..", "..");
const samples_json_path = join(repository_root_directory, "examples", "pico-runtime-samples", "samples.json");

type SampleManifestJson = {
  readonly samples: readonly {
    readonly name: string;
    readonly sourceFile: string;
    readonly traceVars: readonly string[];
  }[];
};

describe("PICO_RUNTIME_SAMPLE_CATALOG_ENTRIES", () => {
  it("includes every manifest sample with non-empty source text and matching trace vars", () => {
    const manifest = JSON.parse(readFileSync(samples_json_path, "utf-8")) as SampleManifestJson;
    expect(PICO_RUNTIME_SAMPLE_CATALOG_ENTRIES.length).toBe(manifest.samples.length);

    for (const manifest_row of manifest.samples) {
      const catalog_entry = PICO_RUNTIME_SAMPLE_CATALOG_ENTRIES.find(
        (entry) => entry.sampleName === manifest_row.name,
      );
      expect(catalog_entry).toBeDefined();
      if (catalog_entry === undefined) {
        return;
      }
      expect(catalog_entry.sourceFileName).toBe(manifest_row.sourceFile);
      expect(catalog_entry.sourceText.trim().length).toBeGreaterThan(0);
      expect([...catalog_entry.traceVarNames]).toEqual([...manifest_row.traceVars]);
    }
  });
});
