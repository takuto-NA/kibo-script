// 責務: Pico vertical slice の JSON package サイズと `KIBO_PKG` 1 行長を、ファームウェア上限（`pico_link_common` / `main.cpp`）に対して評価する。
//
// Guard: Python `pico_link_common.KIBO_FIRMWARE_MAX_DECODED_PACKAGE_BYTES` 等と数値を同期すること。

import { build_kibo_pkg_schema1_serial_line_text_without_newline_from_minified_utf8_bytes } from "./kibo-kibo-pkg-wire-encoding";

/** `runtime/pico/vertical_slice/src/main.cpp` の `k_max_decoded_package_bytes` と一致。 */
export const KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES = 32768;

/** `runtime/pico/vertical_slice/src/main.cpp` の `k_max_serial_line_characters` と一致。 */
export const KIBO_PICO_FIRMWARE_MAX_KIBO_PKG_SERIAL_LINE_CHARACTERS = 49152;

/** minified UTF-8 byte 数がこの割合を超えたら警告（bytecode 着手の目安）。 */
export const KIBO_PICO_PACKAGE_PREFLIGHT_WARN_MINIFIED_BYTE_FRACTION_OF_DECODE_LIMIT = 0.8;

export type KiboPicoPackagePreflightSeverity = "ok" | "warn" | "reject";

export type KiboPicoPackagePreflightAssessment = {
  readonly severity: KiboPicoPackagePreflightSeverity;
  readonly minifiedUtf8ByteCount: number;
  readonly kiboPkgSerialLineCharacterCount: number;
  readonly messages: readonly string[];
};

export function buildKiboPkgSerialLineTextFromMinifiedUtf8Bytes(params: {
  readonly minifiedUtf8Bytes: Uint8Array;
}): string {
  return build_kibo_pkg_schema1_serial_line_text_without_newline_from_minified_utf8_bytes(params.minifiedUtf8Bytes);
}

export function assessKiboPicoRuntimePackageJsonTextPreflightOrThrow(params: {
  readonly canonicalPicoRuntimePackageJsonText: string;
}): KiboPicoPackagePreflightAssessment {
  const packageObject: unknown = JSON.parse(params.canonicalPicoRuntimePackageJsonText);
  const minifiedText = JSON.stringify(packageObject);
  const minifiedUtf8Bytes = new TextEncoder().encode(minifiedText);
  const lineText = buildKiboPkgSerialLineTextFromMinifiedUtf8Bytes({ minifiedUtf8Bytes });
  const minifiedUtf8ByteCount = minifiedUtf8Bytes.byteLength;
  const kiboPkgSerialLineCharacterCount = lineText.length;

  const messages: string[] = [];
  if (minifiedUtf8ByteCount > KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES) {
    messages.push(
      `package_too_large: minified UTF-8 bytes ${minifiedUtf8ByteCount} exceed firmware decode limit ${KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES}.`,
    );
    return {
      severity: "reject",
      minifiedUtf8ByteCount,
      kiboPkgSerialLineCharacterCount,
      messages,
    };
  }
  if (kiboPkgSerialLineCharacterCount > KIBO_PICO_FIRMWARE_MAX_KIBO_PKG_SERIAL_LINE_CHARACTERS) {
    messages.push(
      `serial_line_too_long: KIBO_PKG line has ${kiboPkgSerialLineCharacterCount} characters; firmware limit is ${KIBO_PICO_FIRMWARE_MAX_KIBO_PKG_SERIAL_LINE_CHARACTERS}.`,
    );
    return {
      severity: "reject",
      minifiedUtf8ByteCount,
      kiboPkgSerialLineCharacterCount,
      messages,
    };
  }

  const warnThresholdBytes = Math.floor(
    KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES *
      KIBO_PICO_PACKAGE_PREFLIGHT_WARN_MINIFIED_BYTE_FRACTION_OF_DECODE_LIMIT,
  );
  if (minifiedUtf8ByteCount >= warnThresholdBytes) {
    messages.push(
      `warn: minified UTF-8 bytes ${minifiedUtf8ByteCount} are at or above ${Math.round(
        KIBO_PICO_PACKAGE_PREFLIGHT_WARN_MINIFIED_BYTE_FRACTION_OF_DECODE_LIMIT * 100,
      )}% of decode limit ${KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES} (threshold ${warnThresholdBytes}). Consider bytecode (see docs/bytecode-transfer-design.md).`,
    );
    return {
      severity: "warn",
      minifiedUtf8ByteCount,
      kiboPkgSerialLineCharacterCount,
      messages,
    };
  }

  messages.push(
    `ok: minified UTF-8 bytes ${minifiedUtf8ByteCount} / ${KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES}; KIBO_PKG line ${kiboPkgSerialLineCharacterCount} / ${KIBO_PICO_FIRMWARE_MAX_KIBO_PKG_SERIAL_LINE_CHARACTERS} characters.`,
  );
  return {
    severity: "ok",
    minifiedUtf8ByteCount,
    kiboPkgSerialLineCharacterCount,
    messages,
  };
}
