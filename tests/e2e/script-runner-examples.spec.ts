import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tests_e2e_directory = dirname(fileURLToPath(import.meta.url));
const repository_root_directory = join(tests_e2e_directory, "..", "..");

const pico_runtime_samples_manifest = JSON.parse(
  readFileSync(join(repository_root_directory, "examples", "pico-runtime-samples", "samples.json"), "utf-8"),
) as { readonly samples: readonly { readonly name: string }[] };

function read_example_source_file_text_or_throw(source_file_name: string): string {
  const file_path = join(repository_root_directory, "examples", "pico-runtime-samples", source_file_name);
  return readFileSync(file_path, "utf-8").replace(/\r\n/g, "\n");
}

test("example select lists bundled samples and loads circle-sweep with trace vars", async ({ page }) => {
  await page.goto("/");

  const example_select = page.getByTestId("script-runner-example-select");
  await expect(example_select.locator("option")).toHaveCount(pico_runtime_samples_manifest.samples.length);
  await expect(example_select.locator("option", { hasText: "led-heartbeat" })).toHaveCount(1);
  await expect(example_select.locator("option", { hasText: "circle-sweep" })).toHaveCount(1);
  await expect(example_select.locator("option", { hasText: "button-led-toggle" })).toHaveCount(1);
  await expect(example_select.locator("option", { hasText: "sensor-alert-dashboard" })).toHaveCount(1);
  await expect(example_select.locator("option", { hasText: "state-led-pulse" })).toHaveCount(1);

  await example_select.selectOption("circle-sweep");

  const expected_source_text = read_example_source_file_text_or_throw("circle-sweep.sc");
  await expect(page.getByTestId("script-runner-textarea")).toHaveValue(expected_source_text);
  await expect(page.getByTestId("script-runner-trace-vars-input")).toHaveValue("circle_x");

  await page.getByTestId("script-runner-submit-button").click();
  await expect(page.getByRole("status")).toContainText("ok (reset+registered)", { timeout: 8000 });
});
