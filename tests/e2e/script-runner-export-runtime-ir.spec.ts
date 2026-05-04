import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * script runner で reset compile 後に runtime IR をダウンロードし、JSON の schema と task 名を検証する。
 */
test("download runtime IR after reset compile produces valid runtime IR contract JSON", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("script-runner-submit-button").click();
  await expect(page.getByRole("status")).toContainText("ok (reset+registered)", { timeout: 8000 });

  const download_promise = page.waitForEvent("download");
  await page.getByTestId("script-runner-download-runtime-ir-button").click();
  const download = await download_promise;

  expect(download.suggestedFilename()).toBe("kibo-runtime-ir-contract.json");

  const suggested_path = await download.path();
  if (suggested_path === null) {
    throw new Error("Download path was null.");
  }
  const downloaded_text = readFileSync(suggested_path, "utf-8");
  const parsed = JSON.parse(downloaded_text) as {
    runtimeIrContractSchemaVersion: number;
    compiledProgram: { everyTasks: Array<{ taskName: string }> };
  };

  expect(parsed.runtimeIrContractSchemaVersion).toBe(1);
  expect(parsed.compiledProgram.everyTasks.map((task) => task.taskName)).toEqual(["blink"]);
});

test("download runtime IR before reset compile shows guidance in status", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("script-runner-textarea").fill("ref led = led#0\n");
  await page.getByTestId("script-runner-download-runtime-ir-button").click();

  await expect(page.getByRole("status")).toContainText("No successful reset compile yet", { timeout: 3000 });
});
