/**
 * 責務: tests/compiler/fixtures の golden JSON を compileScript 現行出力で上書きする（開発用ワンショット）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScript } from "../src/compiler/compile-script";
import { serializeCompileScriptResultForGoldenTest } from "../tests/compiler/serialize-compiler-output";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../tests/compiler/fixtures");

const fixtureNames = [
  "blink-led.sc",
  "invalid-unit.sc",
  "serial-print-task.sc",
  "circle-animation.sc",
  "serial-read-adc.sc",
  "button-toggle-on-event.sc",
  "match-string-command.sc",
  "match-non-string-target.sc",
  "match-missing-else.sc",
  "match-wait-branch.sc",
  "fade-animator-linear.sc",
  "fade-animator-ease-in-out.sc",
  "fade-animator-unknown.sc",
  "fade-animator-invalid-unit.sc",
  "fade-animator-invalid-percent.sc",
  "fade-animator-invalid-ease.sc",
  "fade-animator-from-to-with-target.sc",
  "fade-animator-ramp-over.sc",
  "fade-animator-ramp-over-without-target.sc",
  "fade-animator-target-step.sc",
  "fade-animator-target-step-unknown.sc",
  "fade-animator-target-step-invalid-target.sc",
  "fade-animator-target-step-in-event.sc",
  "fade-animator-dt-in-event.sc",
];

for (const name of fixtureNames) {
  const scPath = join(fixturesDir, name);
  const expectedPath = join(fixturesDir, name.replace(/\.sc$/, ".expected.json"));
  const sourceText = readFileSync(scPath, "utf-8").replace(/\r\n/g, "\n");
  const result = compileScript(sourceText, name);
  const serialized = serializeCompileScriptResultForGoldenTest(result);
  writeFileSync(expectedPath, `${JSON.stringify(serialized, null, 2)}\n`, "utf-8");
}

console.log(`Updated ${fixtureNames.length} expected JSON files.`);
