// 責務: `display#0` の presented framebuffer バイト列から、host / Pico / C++ で共有する 64bit FNV-1a フィンガープリントを計算する。
//
// 注意:
// - このアルゴリズムは `docs/runtime-conformance.md` にも記載する。C++ 実装は同じ定数と順序を守る。
// - フィンガープリントは暗号学的ハッシュではない。runtime conformance の差分検知用途に限定する。

import { TOTAL_PIXEL_COUNT } from "../devices/display/display-constants";

const FNV1A64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV1A64_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

/**
 * presented frame の各バイトを 0/1 のみとみなし、FNV-1a 64bit を返す。
 */
export function computePresentedFrameFingerprintFnv1a64FromPresentedFrameBytes(
  presentedFrameBytes: Readonly<Uint8Array>,
): bigint {
  if (presentedFrameBytes.length !== TOTAL_PIXEL_COUNT) {
    throw new Error(
      `presentedFrameBytes length mismatch: expected ${TOTAL_PIXEL_COUNT}, actual ${presentedFrameBytes.length}`,
    );
  }

  let hash = FNV1A64_OFFSET_BASIS;
  for (let byteIndex = 0; byteIndex < presentedFrameBytes.length; byteIndex += 1) {
    const byteValue = BigInt(presentedFrameBytes[byteIndex] ?? 0) & 0xffn;
    hash ^= byteValue;
    hash = (hash * FNV1A64_PRIME) & UINT64_MASK;
  }
  return hash;
}

export function formatFingerprintFnv1a64AsLowerHex16(fingerprint: bigint): string {
  const masked = fingerprint & UINT64_MASK;
  return masked.toString(16).padStart(16, "0");
}
