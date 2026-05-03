#pragma once

#include <nlohmann/json.hpp>

#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>

namespace kibo::runtime {

/**
 * 責務: nlohmann::json の数値（integer / unsigned / 整数に丸められる float）を `int64_t` へ読み取る。
 *
 * 注意: runtime IR の JSON は TypeScript 由来で `number_unsigned` になり得るため、`get<int64_t>` だけに依存しない。
 */
inline std::int64_t read_json_number_as_int64_or_throw(const nlohmann::json& json_value) {
  if (json_value.is_number_integer()) {
    return json_value.get<std::int64_t>();
  }
  if (json_value.is_number_unsigned()) {
    const std::uint64_t unsigned_value = json_value.get<std::uint64_t>();
    if (unsigned_value > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
      throw std::runtime_error("JSON unsigned integer does not fit in int64_t.");
    }
    return static_cast<std::int64_t>(unsigned_value);
  }
  if (json_value.is_number_float()) {
    const double floating = json_value.get<double>();
    if (!std::isfinite(floating)) {
      throw std::runtime_error("JSON number is not finite.");
    }
    const double truncated = std::trunc(floating);
    if (truncated != floating) {
      throw std::runtime_error("JSON number is not an integral float.");
    }
    return static_cast<std::int64_t>(truncated);
  }
  throw std::runtime_error("JSON value is not a number.");
}

inline int read_json_number_as_int_or_throw(const nlohmann::json& json_value) {
  const std::int64_t wide = read_json_number_as_int64_or_throw(json_value);
  if (wide > static_cast<std::int64_t>(std::numeric_limits<int>::max())) {
    throw std::runtime_error("JSON integer does not fit in int (too large).");
  }
  if (wide < static_cast<std::int64_t>(std::numeric_limits<int>::min())) {
    throw std::runtime_error("JSON integer does not fit in int (too small).");
  }
  return static_cast<int>(wide);
}

}  // namespace kibo::runtime
