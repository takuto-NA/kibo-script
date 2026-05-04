#pragma once

// 責務: IEEE 802.3 / PNG / ZIP 互換の CRC32（多項式 0xEDB88320）を計算する。

#include <cstddef>
#include <cstdint>

namespace kibo::runtime {

inline std::uint32_t compute_crc32_over_bytes(const std::uint8_t* data_bytes, std::size_t byte_count) {
  std::uint32_t crc = 0xFFFFFFFFU;
  for (std::size_t byte_index = 0; byte_index < byte_count; byte_index += 1) {
    crc ^= static_cast<std::uint32_t>(data_bytes[byte_index]);
    for (int bit_index = 0; bit_index < 8; bit_index += 1) {
      const std::uint32_t mask = static_cast<std::uint32_t>(0U - (crc & 1U));
      crc >>= 1U;
      crc ^= 0xEDB88320U & mask;
    }
  }
  return crc ^ 0xFFFFFFFFU;
}

}  // namespace kibo::runtime
