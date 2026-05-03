#pragma once

#include "kibo_display_geometry.hpp"

#include <array>
#include <cstdint>
#include <string>

namespace kibo::runtime {

inline constexpr std::uint64_t kFnv1a64OffsetBasis = 0xcbf29ce484222325ULL;
inline constexpr std::uint64_t kFnv1a64Prime = 0x100000001b3ULL;

/**
 * 責務: `display#0` presented framebuffer（1 pixel = 1 byte, 0/1）の FNV-1a 64bit を計算する。
 *
 * 注意: TypeScript の `computePresentedFrameFingerprintFnv1a64FromPresentedFrameBytes` と同じ定義である。
 */
inline std::uint64_t compute_fnv1a64_over_presented_frame_bytes(
    const std::array<std::uint8_t, kDisplayPixelCount>& presented_frame_bytes
) {
  std::uint64_t hash = kFnv1a64OffsetBasis;
  for (const std::uint8_t byte_value : presented_frame_bytes) {
    hash ^= static_cast<std::uint64_t>(byte_value);
    hash *= kFnv1a64Prime;
  }
  return hash;
}

inline std::string format_fnv1a64_as_lower_hex16(std::uint64_t fingerprint) {
  static constexpr char kHexDigits[] = "0123456789abcdef";
  std::string out;
  out.resize(16);
  for (int nibble_index = 0; nibble_index < 16; nibble_index += 1) {
    const int shift_bits = (15 - nibble_index) * 4;
    const std::uint64_t nibble = (fingerprint >> shift_bits) & 0xFULL;
    out[static_cast<std::size_t>(nibble_index)] = kHexDigits[nibble];
  }
  return out;
}

}  // namespace kibo::runtime
