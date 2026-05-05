// 責務: `KiboDeviceProtocolV1UsbSerialIngress` の実装（Arduino 非依存の標準 C++ のみ）。

#include "kibo_device_protocol_v1_serial_ingress.hpp"

#include <cstring>

#include "kibo_device_protocol_v1.hpp"

namespace {

std::uint32_t read_uint32_le_from_vector_or_zero(const std::vector<std::uint8_t>& bytes, std::size_t offset) {
  if (offset + 4 > bytes.size()) {
    return 0;
  }
  const std::uint8_t* pointer = bytes.data() + offset;
  return static_cast<std::uint32_t>(pointer[0]) | (static_cast<std::uint32_t>(pointer[1]) << 8) |
         (static_cast<std::uint32_t>(pointer[2]) << 16) | (static_cast<std::uint32_t>(pointer[3]) << 24);
}

}  // namespace

KiboDeviceProtocolV1UsbSerialIngress::KiboDeviceProtocolV1UsbSerialIngress(
    std::size_t max_line_characters,
    std::size_t max_binary_frame_byte_length
)
    : max_line_characters_(max_line_characters),
      max_binary_frame_byte_length_(max_binary_frame_byte_length) {}

void KiboDeviceProtocolV1UsbSerialIngress::reset_binary_accumulator_only() {
  is_binary_accumulating_ = false;
  binary_frame_bytes_.clear();
}

bool KiboDeviceProtocolV1UsbSerialIngress::is_kibo_device_protocol_v1_prefix_from_first_six_line_bytes() const {
  if (line_characters_.size() < 6) {
    return false;
  }
  if (line_characters_[0] != 'K' || line_characters_[1] != 'I' || line_characters_[2] != 'B' || line_characters_[3] != 'O') {
    return false;
  }
  const auto underscore_character = static_cast<char>(0x5F);
  if (line_characters_[4] == underscore_character) {
    return false;
  }
  const unsigned char version_low = static_cast<unsigned char>(line_characters_[4]);
  const unsigned char version_high = static_cast<unsigned char>(line_characters_[5]);
  return version_low == 0x01U && version_high == 0x00U;
}

bool KiboDeviceProtocolV1UsbSerialIngress::try_emit_completed_binary_frame_or_false(
    const std::function<void(const std::vector<std::uint8_t>& complete_frame_bytes)>& on_completed_binary_frame,
    const std::function<void(const char* diag_text)>& on_ingress_reset_due_to_corruption
) {
  if (binary_frame_bytes_.size() < kibo::device_protocol::v1::k_frame_header_byte_length) {
    return false;
  }

  const std::uint32_t body_byte_length =
      read_uint32_le_from_vector_or_zero(binary_frame_bytes_, 12);
  const std::size_t expected_total_frame_byte_length =
      kibo::device_protocol::v1::k_frame_header_byte_length + body_byte_length + 4;

  if (expected_total_frame_byte_length > max_binary_frame_byte_length_) {
    reset_binary_accumulator_only();
    on_ingress_reset_due_to_corruption("trace schema=1 diag=kibo_device_protocol_v1_frame_too_large");
    return false;
  }

  if (binary_frame_bytes_.size() < expected_total_frame_byte_length) {
    return false;
  }

  std::vector<std::uint8_t> complete_frame(
      binary_frame_bytes_.begin(),
      binary_frame_bytes_.begin() + static_cast<std::ptrdiff_t>(expected_total_frame_byte_length));
  binary_frame_bytes_.erase(
      binary_frame_bytes_.begin(),
      binary_frame_bytes_.begin() + static_cast<std::ptrdiff_t>(expected_total_frame_byte_length));

  on_completed_binary_frame(complete_frame);

  if (binary_frame_bytes_.empty()) {
    is_binary_accumulating_ = false;
  }

  return true;
}

void KiboDeviceProtocolV1UsbSerialIngress::feed_byte(
    std::uint8_t byte,
    const std::function<void(const std::string& completed_line_without_newline)>& on_completed_line,
    const std::function<void(const std::vector<std::uint8_t>& complete_frame_bytes)>& on_completed_binary_frame,
    const std::function<void(const char* diag_text)>& on_ingress_reset_due_to_corruption
) {
  if (is_binary_accumulating_) {
    binary_frame_bytes_.push_back(byte);
    if (binary_frame_bytes_.size() > max_binary_frame_byte_length_) {
      reset_binary_accumulator_only();
      on_ingress_reset_due_to_corruption("trace schema=1 diag=kibo_device_protocol_v1_binary_buffer_overflow");
      return;
    }

    while (try_emit_completed_binary_frame_or_false(on_completed_binary_frame, on_ingress_reset_due_to_corruption)) {
      // Guard: 同一バッファに複数フレームが連結された場合は連続で処理する。
    }
    return;
  }

  if (byte == '\n') {
    std::string completed_line = line_characters_;
    line_characters_.clear();
    if (!completed_line.empty() && completed_line.back() == '\r') {
      completed_line.pop_back();
    }
    if (!completed_line.empty()) {
      on_completed_line(completed_line);
    }
    return;
  }

  if (line_characters_.size() >= max_line_characters_) {
    line_characters_.clear();
    on_ingress_reset_due_to_corruption("trace schema=1 diag=serial_line_too_long");
    return;
  }

  line_characters_.push_back(static_cast<char>(byte));

  if (line_characters_.size() >= 6 && is_kibo_device_protocol_v1_prefix_from_first_six_line_bytes()) {
    binary_frame_bytes_.reserve(max_binary_frame_byte_length_);
    binary_frame_bytes_.assign(line_characters_.begin(), line_characters_.end());
    line_characters_.clear();
    is_binary_accumulating_ = true;

    while (try_emit_completed_binary_frame_or_false(on_completed_binary_frame, on_ingress_reset_due_to_corruption)) {
      // Guard: ヘッダだけで完結する短いフレームもあるため、即座に完了処理できる場合がある。
    }
  }
}
