// 責務: Web Serial 向け v1 chunked upload フレーム列が Python uploader と同順・同種別であることを Vitest で固定する。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decode_kibo_device_protocol_v1_frame,
  KiboDeviceProtocolV1MessageKind,
} from "../../src/device-protocol/kibo-device-protocol-v1";
import {
  build_kibo_device_protocol_v1_web_serial_upload_frames_or_throw,
  is_kibo_device_protocol_v1_run_package_frame_bytes,
  KIBO_DEVICE_PROTOCOL_V1_WEB_SERIAL_DEFAULT_CHUNK_RAW_UTF8_BYTE_LENGTH,
} from "../../src/ui/kibo-device-protocol-v1-web-serial-upload-frames";
import {
  assessKiboPicoRuntimePackageJsonTextPreflightForDeviceProtocolV1WebSerialOrThrow,
  buildKiboPkgSerialLineTextFromMinifiedUtf8Bytes,
  KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES,
  KIBO_PICO_FIRMWARE_MAX_KIBO_PKG_SERIAL_LINE_CHARACTERS,
} from "../../src/runtime-conformance/kibo-pico-package-preflight";

const tests_directory = dirname(fileURLToPath(import.meta.url));

describe("kibo-device-protocol-v1-web-serial-upload-frames", () => {
  it("blink-led golden produces HELLO then FILE_BEGIN then FILE_CHUNK then FILE_COMMIT then RUN_PACKAGE", () => {
    const golden_path = join(tests_directory, "golden", "pico-runtime-packages", "blink-led.pico-runtime-package.json");
    const package_text = readFileSync(golden_path, "utf-8");
    const minified_utf8_bytes = new TextEncoder().encode(JSON.stringify(JSON.parse(package_text) as unknown));

    const frames = build_kibo_device_protocol_v1_web_serial_upload_frames_or_throw({
      minifiedPicoRuntimePackageUtf8Bytes: minified_utf8_bytes,
      chunkRawUtf8ByteLength: 64,
      fileId: 1,
      requestId: 1,
      initialSequence: 0,
    });

    const expected_chunk_count = Math.ceil(minified_utf8_bytes.byteLength / 64);
    expect(frames.length).toBe(1 + 1 + expected_chunk_count + 1 + 1);

    const decoded_kinds = frames.map((frame) => {
      const decoded = decode_kibo_device_protocol_v1_frame(frame);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) {
        return KiboDeviceProtocolV1MessageKind.RESERVED;
      }
      return decoded.value.messageKind;
    });

    expect(decoded_kinds[0]).toBe(KiboDeviceProtocolV1MessageKind.HELLO);
    expect(decoded_kinds[1]).toBe(KiboDeviceProtocolV1MessageKind.FILE_BEGIN);
    for (let index = 0; index < expected_chunk_count; index += 1) {
      expect(decoded_kinds[2 + index]).toBe(KiboDeviceProtocolV1MessageKind.FILE_CHUNK);
    }
    expect(decoded_kinds[2 + expected_chunk_count]).toBe(KiboDeviceProtocolV1MessageKind.FILE_COMMIT);
    expect(decoded_kinds[2 + expected_chunk_count + 1]).toBe(KiboDeviceProtocolV1MessageKind.RUN_PACKAGE);

    expect(is_kibo_device_protocol_v1_run_package_frame_bytes(frames[frames.length - 1]!)).toBe(true);
  });

  it("default chunk size matches Python uploader constant", () => {
    expect(KIBO_DEVICE_PROTOCOL_V1_WEB_SERIAL_DEFAULT_CHUNK_RAW_UTF8_BYTE_LENGTH).toBe(768);
  });
});

describe("kibo-pico-package-preflight device protocol v1 Web Serial", () => {
  it("rejects minified UTF-8 payload above firmware staging limit", () => {
    const oversized_object = { filler: "y".repeat(15000) };
    const canonical_text = JSON.stringify(oversized_object);
    const result = assessKiboPicoRuntimePackageJsonTextPreflightForDeviceProtocolV1WebSerialOrThrow({
      canonicalPicoRuntimePackageJsonText: canonical_text,
    });
    expect(result.severity).toBe("reject");
    expect(result.messages.some((message) => message.includes("package_too_large"))).toBe(true);
  });

  it("allows minified JSON under staging limit even when legacy KIBO_PKG line exceeds firmware line limit", () => {
    const filler_repetition_count = 12270;
    const canonical_text = JSON.stringify({ filler: "x".repeat(filler_repetition_count) });
    const minified_utf8_bytes = new TextEncoder().encode(JSON.stringify(JSON.parse(canonical_text) as unknown));
    expect(minified_utf8_bytes.byteLength).toBeLessThanOrEqual(KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES);

    const line_text = buildKiboPkgSerialLineTextFromMinifiedUtf8Bytes({ minifiedUtf8Bytes: minified_utf8_bytes });
    expect(line_text.length).toBeGreaterThan(KIBO_PICO_FIRMWARE_MAX_KIBO_PKG_SERIAL_LINE_CHARACTERS);

    const result = assessKiboPicoRuntimePackageJsonTextPreflightForDeviceProtocolV1WebSerialOrThrow({
      canonicalPicoRuntimePackageJsonText: canonical_text,
    });
    expect(result.severity).not.toBe("reject");
    expect(result.messages.some((message) => message.includes("info: legacy KIBO_PKG"))).toBe(true);
  });
});
