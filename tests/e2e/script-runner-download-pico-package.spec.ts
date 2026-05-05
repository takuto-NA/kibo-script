import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Fake serial port trace lines below assume this blink script (1000ms every task).
 */
const E2E_BLINK_SCRIPT_TEXT_FOR_FIXED_TRACE_FAKE_SERIAL_PORT = `ref led = led#0

task blink every 1000ms {
  do led.toggle()
}
`;

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
  expect(parsed.live.tickIntervalMilliseconds).toBe(500);
  expect(parsed.runtimeIrContract.compiledProgram.everyTasks.map((task) => task.taskName)).toEqual(["heartbeat"]);
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

  await page.getByTestId("script-runner-textarea").fill(E2E_BLINK_SCRIPT_TEXT_FOR_FIXED_TRACE_FAKE_SERIAL_PORT);
  await page.getByTestId("script-runner-write-pico-button").click();

  await expect(page.getByRole("status")).toContainText("ok: simulator and Pico matched", { timeout: 8000 });
  await expect(page.getByRole("status")).toContainText("trace lines verified: 3");
});

test("Pico write shows loader recovery when KIBO_PING does not return protocol=1", async ({ page }) => {
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
            enqueue_line("not_a_loader_line");
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

  await page.getByTestId("script-runner-textarea").fill(E2E_BLINK_SCRIPT_TEXT_FOR_FIXED_TRACE_FAKE_SERIAL_PORT);
  await page.getByTestId("script-runner-write-pico-button").click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Pico loader did not respond", { timeout: 8000 });
  await expect(status).toContainText("install_pico_loader.py");
  await expect(status).toContainText("pico_link_doctor.py");
});

test("Pico write rejects large package before upload when loader does not report raised limits", async ({ page }) => {
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
            enqueue_line("kibo_loader status=ok protocol=1 active=old-firmware");
          }
          if (text.includes("KIBO_PKG")) {
            enqueue_line("trace schema=1 diag=serial_line_too_long");
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

  await page.getByTestId("script-runner-example-select").selectOption("radio-state-tuner");
  await page.getByTestId("script-runner-write-pico-button").click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Pico loader firmware is too old for this package size", { timeout: 8000 });
  await expect(status).toContainText("install_pico_loader.py");
});

test("Pico write shows ack recovery when package is not acknowledged", async ({ page }) => {
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
            enqueue_line("kibo_pkg_ack status=error reason=e2e_negative");
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

  await page.getByTestId("script-runner-textarea").fill(E2E_BLINK_SCRIPT_TEXT_FOR_FIXED_TRACE_FAKE_SERIAL_PORT);
  await page.getByTestId("script-runner-write-pico-button").click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Pico did not acknowledge the package", { timeout: 8000 });
  await expect(status).toContainText("upload_pico_runtime_package.py");
});

test("Pico write shows trace mismatch recovery including trace-var CLI hint", async ({ page }) => {
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
            enqueue_line("trace schema=1 sim_ms=0 led0=0 btn0=0 dpy_fp=deadbeefdeadbeef vars=- sm=-");
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

  await page.getByTestId("script-runner-textarea").fill(E2E_BLINK_SCRIPT_TEXT_FOR_FIXED_TRACE_FAKE_SERIAL_PORT);
  await page.getByTestId("script-runner-trace-vars-input").fill("circle_x");
  await page.getByTestId("script-runner-write-pico-button").click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Pico trace did not match simulator replay", { timeout: 12000 });
  await expect(status).toContainText("pico_link_check.py");
  await expect(status).toContainText("--trace-var circle_x");
});
