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

test("Pico write action is discoverable from the script runner", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("script-runner-write-pico-button")).toHaveText("Run simulator & write to Pico");
});

test("Pico write action uploads through Web Serial and verifies trace", async ({ page }) => {
  await page.addInitScript(() => {
    const encoder = new TextEncoder();
    let readable_controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const enqueue_line = (line: string) => {
      readable_controller?.enqueue(encoder.encode(`${line}\n`));
    };
    const fake_port = {
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          readable_controller = controller;
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write(chunk) {
          const text = new TextDecoder().decode(chunk);
          if (text.includes("KIBO_PING")) {
            enqueue_line("kibo_loader status=ok protocol=1 active=e2e-fake");
          }
          if (text.includes("KIBO_PKG")) {
            enqueue_line("kibo_pkg_ack status=ok");
            enqueue_line("trace schema=1 sim_ms=0 led0=0 btn0=0 dpy_fp=b9d103fd6854a325 vars=- sm=-");
            enqueue_line("trace schema=1 sim_ms=1000 led0=1 btn0=0 dpy_fp=b9d103fd6854a325 vars=- sm=-");
            enqueue_line("trace schema=1 sim_ms=2000 led0=0 btn0=0 dpy_fp=b9d103fd6854a325 vars=- sm=-");
          }
        },
      }),
      async open() {},
      async close() {},
    };

    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        async requestPort() {
          return fake_port;
        },
      },
    });
  });
  await page.goto("/");

  await page.getByTestId("script-runner-write-pico-button").click();

  await expect(page.getByRole("status")).toContainText("ok: simulator and Pico matched", { timeout: 8000 });
  await expect(page.getByRole("status")).toContainText("trace lines verified: 3");
});
