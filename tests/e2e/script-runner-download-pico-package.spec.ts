import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

type DeviceProtocolV1FakeSerialResponseMode = "success" | "ack_error" | "trace_mismatch";

/**
 * Guard: `RUN_PACKAGE` フレーム検知は [src/ui/kibo-device-protocol-v1-web-serial-upload-frames.ts] の
 * `is_kibo_device_protocol_v1_run_package_frame_bytes` と同じ最小条件に合わせる。
 */
async function install_kibo_device_protocol_v1_web_serial_fake_port(
  page: Page,
  mode: DeviceProtocolV1FakeSerialResponseMode,
): Promise<void> {
  const injected_mode_json_text = JSON.stringify(mode);
  await page.addInitScript({
    content: `
(() => {
  const injected_mode = ${injected_mode_json_text};
  const encoder = new TextEncoder();
  let readable_controller;
  const enqueue_line = (line) => {
    readable_controller?.enqueue(encoder.encode(line + "\\n"));
  };
  const KIBO_DEVICE_PROTOCOL_V1_RUN_PACKAGE_MESSAGE_KIND_BYTE = 11;
  const is_kibo_device_protocol_v1_run_package_frame_bytes = (bytes) => {
    const minimum_frame_byte_length = 20 + 12 + 4;
    if (bytes.byteLength < minimum_frame_byte_length) {
      return false;
    }
    if (bytes[0] !== 0x4b || bytes[1] !== 0x49 || bytes[2] !== 0x42 || bytes[3] !== 0x4f) {
      return false;
    }
    const body_byte_length = new DataView(bytes.buffer, bytes.byteOffset + 12, 4).getUint32(0, true);
    const expected_total_byte_length = 20 + body_byte_length + 4;
    if (bytes.byteLength !== expected_total_byte_length) {
      return false;
    }
    return bytes[20] === KIBO_DEVICE_PROTOCOL_V1_RUN_PACKAGE_MESSAGE_KIND_BYTE;
  };
  const fake_port = {
    readable: new ReadableStream({
      start(controller) {
        readable_controller = controller;
      },
    }),
    writable: new WritableStream({
      write(chunk) {
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        const text = new TextDecoder().decode(bytes);
        if (text.includes("KIBO_PING")) {
          enqueue_line("kibo_loader status=ok protocol=1 active=e2e-fake");
        }
        if (!is_kibo_device_protocol_v1_run_package_frame_bytes(bytes)) {
          return;
        }
        if (injected_mode === "success") {
          enqueue_line("kibo_pkg_ack status=ok");
          enqueue_line("trace schema=1 sim_ms=0 led0=0 btn0=0 dpy_fp=b9d103fd6854a325 vars=- sm=-");
          enqueue_line("trace schema=1 sim_ms=1000 led0=1 btn0=0 dpy_fp=b9d103fd6854a325 vars=- sm=-");
          enqueue_line("trace schema=1 sim_ms=2000 led0=0 btn0=0 dpy_fp=b9d103fd6854a325 vars=- sm=-");
          return;
        }
        if (injected_mode === "ack_error") {
          enqueue_line("kibo_pkg_ack status=error reason=e2e_negative");
          return;
        }
        enqueue_line("kibo_pkg_ack status=ok");
        enqueue_line("trace schema=1 sim_ms=0 led0=0 btn0=0 dpy_fp=deadbeefdeadbeef vars=- sm=-");
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
})();
`,
  });
}

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
  await install_kibo_device_protocol_v1_web_serial_fake_port(page, "success");
  await page.goto("/");

  await page.getByTestId("script-runner-textarea").fill(E2E_BLINK_SCRIPT_TEXT_FOR_FIXED_TRACE_FAKE_SERIAL_PORT);
  await page.getByTestId("script-runner-write-pico-button").click();

  await expect(page.getByRole("status")).toContainText("ok: simulator and Pico matched", { timeout: 8000 });
  await expect(page.getByRole("status")).toContainText("device protocol v1 chunked Web Serial");
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

test("Pico write shows ack recovery when package is not acknowledged", async ({ page }) => {
  await install_kibo_device_protocol_v1_web_serial_fake_port(page, "ack_error");
  await page.goto("/");

  await page.getByTestId("script-runner-textarea").fill(E2E_BLINK_SCRIPT_TEXT_FOR_FIXED_TRACE_FAKE_SERIAL_PORT);
  await page.getByTestId("script-runner-write-pico-button").click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Pico did not acknowledge the package", { timeout: 8000 });
  await expect(status).toContainText("upload_pico_runtime_package_via_device_protocol_v1.py");
  await expect(status).toContainText("upload_pico_runtime_package.py");
});

test("Pico write shows trace mismatch recovery including trace-var CLI hint", async ({ page }) => {
  await install_kibo_device_protocol_v1_web_serial_fake_port(page, "trace_mismatch");
  await page.goto("/");

  await page.getByTestId("script-runner-textarea").fill(E2E_BLINK_SCRIPT_TEXT_FOR_FIXED_TRACE_FAKE_SERIAL_PORT);
  await page.getByTestId("script-runner-trace-vars-input").fill("circle_x");
  await page.getByTestId("script-runner-write-pico-button").click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Pico trace did not match simulator replay", { timeout: 12000 });
  await expect(status).toContainText("pico_link_check.py");
  await expect(status).toContainText("--trace-var circle_x");
});
