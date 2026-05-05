// 責務: RAM 容量実験用に `PicoRuntimePackage` JSON に未知トップレベルキー `ramProbePadding` を載せ、minified UTF-8 バイト数を目標値に合わせる（ファームウェアは未参照キーを保持するのみ）。
//
// Guard: `KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES`（12288）を超える target は拒否する。Python `pico_link_common.build_minified_pico_runtime_package_utf8_bytes_with_ram_probe_padding_target_length_or_raise` と同じ二分手法。

import { KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES } from "./kibo-pico-package-preflight";

export const KIBO_PICO_RUNTIME_PACKAGE_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME = "ramProbePadding" as const;

export function buildMinifiedUtf8BytesWithRamProbePaddingTargetLengthOrThrow(params: {
  readonly templatePackageRoot: unknown;
  readonly targetMinifiedUtf8ByteCount: number;
}): Uint8Array {
  const { templatePackageRoot, targetMinifiedUtf8ByteCount } = params;
  if (targetMinifiedUtf8ByteCount > KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES) {
    throw new Error(
      `targetMinifiedUtf8ByteCount ${targetMinifiedUtf8ByteCount} exceeds firmware limit ${KIBO_PICO_FIRMWARE_MAX_DECODED_PACKAGE_UTF8_BYTES}.`,
    );
  }
  const encoder = new TextEncoder();
  const padding_unit = "x";
  const mutable_root = JSON.parse(JSON.stringify(templatePackageRoot)) as Record<string, unknown>;

  let high = targetMinifiedUtf8ByteCount + 4096;
  while (true) {
    mutable_root[KIBO_PICO_RUNTIME_PACKAGE_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME] = padding_unit.repeat(high);
    const candidate_high = encoder.encode(JSON.stringify(mutable_root));
    if (candidate_high.byteLength >= targetMinifiedUtf8ByteCount) {
      break;
    }
    high *= 2;
    if (high > 5_000_000) {
      throw new Error("Failed to bracket ramProbePadding length for target byte count.");
    }
  }

  let low = 0;
  let best_length = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    mutable_root[KIBO_PICO_RUNTIME_PACKAGE_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME] = padding_unit.repeat(mid);
    const candidate_bytes = encoder.encode(JSON.stringify(mutable_root));
    const candidate_len = candidate_bytes.byteLength;
    if (candidate_len === targetMinifiedUtf8ByteCount) {
      return candidate_bytes;
    }
    if (candidate_len < targetMinifiedUtf8ByteCount) {
      best_length = Math.max(best_length, mid);
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  mutable_root[KIBO_PICO_RUNTIME_PACKAGE_RAM_PROBE_PADDING_TOP_LEVEL_FIELD_NAME] = padding_unit.repeat(best_length);
  const final_bytes = encoder.encode(JSON.stringify(mutable_root));
  if (final_bytes.byteLength !== targetMinifiedUtf8ByteCount) {
    throw new Error(
      `Could not reach exact targetMinifiedUtf8ByteCount=${targetMinifiedUtf8ByteCount}; best reached ${final_bytes.byteLength} with padding length ${best_length}.`,
    );
  }
  return final_bytes;
}
