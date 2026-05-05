// 責務: `KIBO_PKG` serial line の CRC32 / Base64 が Python `zlib.crc32` / Node `crc32` と整合することを固定する。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { crc32 } from "node:zlib";
import { build_kibo_pkg_schema1_serial_line_text_without_newline_from_minified_utf8_bytes } from "../../src/runtime-conformance/kibo-kibo-pkg-wire-encoding";
import { build_kibo_package_serial_line } from "../../src/ui/script-runner-view";

describe("KIBO_PKG serial line encoding", () => {
  it("builds a decodable frame for the blink-led golden package (minified JSON bytes)", () => {
    const tests_directory = dirname(fileURLToPath(import.meta.url));
    const golden_path = join(tests_directory, "golden", "pico-runtime-packages", "blink-led.pico-runtime-package.json");
    const package_text = readFileSync(golden_path, "utf-8");
    const package_object = JSON.parse(package_text) as unknown;
    const minified_text = JSON.stringify(package_object);
    const minified_bytes = new TextEncoder().encode(minified_text);

    const crc32_value = crc32(Buffer.from(minified_bytes)) >>> 0;
    const base64_payload = Buffer.from(minified_bytes).toString("base64");
    const line_expected = `KIBO_PKG schema=1 bytes=${minified_bytes.length} crc32=${crc32_value.toString(16).padStart(8, "0")} b64=${base64_payload}`;

    const line_from_shared_encoder =
      build_kibo_pkg_schema1_serial_line_text_without_newline_from_minified_utf8_bytes(minified_bytes);
    expect(line_from_shared_encoder).toBe(line_expected);

    const line = line_expected;
    expect(line.startsWith("KIBO_PKG ")).toBe(true);

    const marker = " b64=";
    const marker_index = line.indexOf(marker);
    expect(marker_index).toBeGreaterThan(0);
    const meta_text = line.slice(0, marker_index);
    const base64_text = line.slice(marker_index + marker.length);
    const decoded = Buffer.from(base64_text, "base64");
    expect(decoded.equals(Buffer.from(minified_bytes))).toBe(true);
    expect(meta_text.includes(`bytes=${minified_bytes.length}`)).toBe(true);
    expect(meta_text.includes(`crc32=${crc32_value.toString(16).padStart(8, "0")}`)).toBe(true);
  });

  it("script-runner Web Serial upload minifies pretty package JSON before framing", () => {
    const pretty_package_text = JSON.stringify(
      {
        live: { tickIntervalMilliseconds: 1000 },
        packageSchemaVersion: 1,
        replay: { steps: [{ kind: "collect_trace" }] },
      },
      undefined,
      2,
    );
    const minified_package_text = JSON.stringify(JSON.parse(pretty_package_text) as unknown);
    const line = build_kibo_package_serial_line(pretty_package_text).trimEnd();
    const marker = " b64=";
    const marker_index = line.indexOf(marker);
    expect(marker_index).toBeGreaterThan(0);

    const meta_text = line.slice(0, marker_index);
    const base64_text = line.slice(marker_index + marker.length);
    const decoded_text = Buffer.from(base64_text, "base64").toString("utf-8");
    expect(decoded_text).toBe(minified_package_text);
    expect(decoded_text).not.toContain("\n");
    expect(meta_text.includes(`bytes=${new TextEncoder().encode(minified_package_text).byteLength}`)).toBe(true);
  });
});
