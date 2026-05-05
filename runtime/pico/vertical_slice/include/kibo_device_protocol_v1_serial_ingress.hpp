#pragma once

// 責務: USB Serial のバイト列から Kibo Device Protocol v1 フレームを抽出し、レガシー改行フレームと共存させる ingress。
//
// Guard: v1 判定は先頭 6 バイトが `KIBO` + `protocol_version=1` LE と一致した時点でバイナリ・モードへ遷移する。

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

class KiboDeviceProtocolV1UsbSerialIngress {
public:
  KiboDeviceProtocolV1UsbSerialIngress(std::size_t max_line_characters, std::size_t max_binary_frame_byte_length);

  void feed_byte(
      std::uint8_t byte,
      const std::function<void(const std::string& completed_line_without_newline)>& on_completed_line,
      const std::function<void(const std::vector<std::uint8_t>& complete_frame_bytes)>& on_completed_binary_frame,
      const std::function<void(const char* diag_text)>& on_ingress_reset_due_to_corruption
  );

  void reset_binary_accumulator_only();

private:
  bool is_kibo_device_protocol_v1_prefix_from_first_six_line_bytes() const;

  bool try_emit_completed_binary_frame_or_false(
      const std::function<void(const std::vector<std::uint8_t>& complete_frame_bytes)>& on_completed_binary_frame,
      const std::function<void(const char* diag_text)>& on_ingress_reset_due_to_corruption
  );

  std::size_t max_line_characters_;
  std::size_t max_binary_frame_byte_length_;

  bool is_binary_accumulating_ = false;
  std::string line_characters_;
  std::vector<std::uint8_t> binary_frame_bytes_;
};
