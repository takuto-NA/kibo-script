import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * script runner で reset compile 後に PicoRuntimePackage をダウンロードし、JSON の schema と tick を検証する。
 */
test("download Pico package after reset compile produces valid PicoRuntimePackage JSON", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("script-runner-submit-button").click();
  await expect(page.getByRole("status")).toContainText("ok (reset+registered)", { timeout: 8000 });

  const download_promise = page.waitForEvent("download");
  await page.getByTestId("script-runner-download-pico-package-button").click();
  const download = await download_promise;

  expect(download.suggestedFilename()).toBe("kibo-pico-runtime-package.json");

  const suggested_path = await download.path();
  if (suggested_path === null) {
    throw new Error("Download path was null.");
  }
  const downloaded_text = readFileSync(suggested_path, "utf-8");
  const parsed = JSON.parse(downloaded_text) as {
    packageSchemaVersion: number;
    live: { tickIntervalMilliseconds: number };
    replay: { steps: Array<{ kind: string }> };
    runtimeIrContract: { compiledProgram: { everyTasks: Array<{ taskName: string }> } };
  };

  expect(parsed.packageSchemaVersion).toBe(1);
  expect(parsed.live.tickIntervalMilliseconds).toBe(1000);
  expect(parsed.runtimeIrContract.compiledProgram.everyTasks.map((task) => task.taskName)).toEqual(["blink"]);
  expect(parsed.replay.steps.map((step) => step.kind)).toEqual([
    "collect_trace",
    "tick_ms",
    "collect_trace",
    "tick_ms",
    "collect_trace",
  ]);
});

test("download Pico package before reset compile shows guidance in status", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("script-runner-download-pico-package-button").click();

  await expect(page.getByRole("status")).toContainText("No successful reset compile yet", { timeout: 3000 });
});
