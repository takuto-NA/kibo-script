#pragma once

// 責務: Kibo Device Protocol v1 のフレーム定数・message_kind・CRC 検証付き decode / encode（host runtime / Pico で共有）。
//
// Guard: TypeScript `kibo-device-protocol-v1.ts` / Python `kibo_device_protocol_v1.py` とバイト布局を一致させること。

#include <array>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

#include "kibo_crc32.hpp"
#include "kibo_pico_runtime_package_storage_limits.hpp"

namespace kibo::device_protocol::v1 {

inline constexpr std::size_t k_frame_magic_byte_length = 4;
inline constexpr std::array<std::uint8_t, k_frame_magic_byte_length> k_frame_magic_bytes = {
    static_cast<std::uint8_t>('K'),
    static_cast<std::uint8_t>('I'),
    static_cast<std::uint8_t>('B'),
    static_cast<std::uint8_t>('O'),
};
inline constexpr std::uint16_t k_protocol_version_u16_le = 1;
inline constexpr std::size_t k_frame_header_byte_length = 20;
inline constexpr std::size_t k_envelope_byte_length = 12;
inline constexpr std::size_t k_header_crc_input_byte_length = 16;
inline constexpr std::uint8_t k_codec_id_json_utf8 = 0;

inline constexpr std::size_t k_max_body_byte_length_vertical_slice = 4096;
inline constexpr std::size_t k_max_committed_file_byte_length_vertical_slice =
    kibo::pico::runtime_package::k_max_minified_utf8_byte_length_for_vertical_slice;

enum class MessageKind : std::uint8_t {
  RESERVED = 0,
  HELLO = 1,
  CAPABILITIES = 2,
  PING = 3,
  PONG = 4,
  LOG = 5,
  TRACE = 6,
  ERROR = 7,
  FILE_BEGIN = 8,
  FILE_CHUNK = 9,
  FILE_COMMIT = 10,
  RUN_PACKAGE = 11,
};

inline std::uint16_t read_uint16_le_from_bytes(const std::uint8_t* bytes) {
  return static_cast<std::uint16_t>(bytes[0]) | (static_cast<std::uint16_t>(bytes[1]) << 8);
}

inline std::uint32_t read_uint32_le_from_bytes(const std::uint8_t* bytes) {
  return static_cast<std::uint32_t>(bytes[0]) | (static_cast<std::uint32_t>(bytes[1]) << 8) |
         (static_cast<std::uint32_t>(bytes[2]) << 16) | (static_cast<std::uint32_t>(bytes[3]) << 24);
}

inline void write_uint16_le_to_bytes(std::uint8_t* destination, std::uint16_t value) {
  destination[0] = static_cast<std::uint8_t>(value & 0xFFU);
  destination[1] = static_cast<std::uint8_t>((value >> 8) & 0xFFU);
}

inline void write_uint32_le_to_bytes(std::uint8_t* destination, std::uint32_t value) {
  destination[0] = static_cast<std::uint8_t>(value & 0xFFU);
  destination[1] = static_cast<std::uint8_t>((value >> 8) & 0xFFU);
  destination[2] = static_cast<std::uint8_t>((value >> 16) & 0xFFU);
  destination[3] = static_cast<std::uint8_t>((value >> 24) & 0xFFU);
}

struct DecodedFrame {
  std::uint32_t sequence = 0;
  MessageKind message_kind = MessageKind::RESERVED;
  std::uint8_t codec_id = 0;
  std::uint16_t envelope_flags = 0;
  std::uint32_t request_id = 0;
  std::vector<std::uint8_t> payload_utf8_bytes;
};

enum class DecodeFrameErrorCode {
  FRAME_TOO_SHORT,
  INVALID_MAGIC,
  UNSUPPORTED_PROTOCOL_VERSION,
  HEADER_CRC_MISMATCH,
  BODY_CRC_MISMATCH,
  BODY_LENGTH_INCONSISTENT,
  PAYLOAD_LENGTH_INCONSISTENT,
  UNSUPPORTED_CODEC_ID,
  BODY_TOO_LARGE_FOR_DEVICE,
};

inline bool try_decode_kibo_device_protocol_v1_frame_from_bytes(
    const std::vector<std::uint8_t>& frame_bytes,
    DecodedFrame& out_decoded_frame,
    DecodeFrameErrorCode& out_error_code,
    std::size_t max_body_byte_length = k_max_body_byte_length_vertical_slice
) {
  const std::size_t minimum_length = k_frame_header_byte_length + k_envelope_byte_length + 4;
  if (frame_bytes.size() < minimum_length) {
    out_error_code = DecodeFrameErrorCode::FRAME_TOO_SHORT;
    return false;
  }

  for (std::size_t index = 0; index < k_frame_magic_byte_length; index += 1) {
    if (frame_bytes.at(index) != k_frame_magic_bytes.at(index)) {
      out_error_code = DecodeFrameErrorCode::INVALID_MAGIC;
      return false;
    }
  }

  const std::uint16_t protocol_version = read_uint16_le_from_bytes(frame_bytes.data() + 4);
  if (protocol_version != k_protocol_version_u16_le) {
    out_error_code = DecodeFrameErrorCode::UNSUPPORTED_PROTOCOL_VERSION;
    return false;
  }

  const std::uint32_t actual_header_crc =
      kibo::runtime::compute_crc32_over_bytes(frame_bytes.data(), k_header_crc_input_byte_length);
  const std::uint32_t expected_header_crc = read_uint32_le_from_bytes(frame_bytes.data() + 16);
  if (actual_header_crc != expected_header_crc) {
    out_error_code = DecodeFrameErrorCode::HEADER_CRC_MISMATCH;
    return false;
  }

  const std::uint32_t sequence = read_uint32_le_from_bytes(frame_bytes.data() + 8);
  const std::uint32_t body_byte_length = read_uint32_le_from_bytes(frame_bytes.data() + 12);

  if (body_byte_length > max_body_byte_length) {
    out_error_code = DecodeFrameErrorCode::BODY_TOO_LARGE_FOR_DEVICE;
    return false;
  }

  const std::size_t expected_total_length = k_frame_header_byte_length + body_byte_length + 4;
  if (frame_bytes.size() != expected_total_length) {
    out_error_code = DecodeFrameErrorCode::BODY_LENGTH_INCONSISTENT;
    return false;
  }

  const std::uint8_t* body_pointer = frame_bytes.data() + k_frame_header_byte_length;
  const std::uint32_t actual_body_crc =
      kibo::runtime::compute_crc32_over_bytes(body_pointer, body_byte_length);
  const std::uint32_t expected_body_crc = read_uint32_le_from_bytes(body_pointer + body_byte_length);
  if (actual_body_crc != expected_body_crc) {
    out_error_code = DecodeFrameErrorCode::BODY_CRC_MISMATCH;
    return false;
  }

  const std::uint8_t message_kind_byte = body_pointer[0];
  const std::uint8_t codec_id = body_pointer[1];
  const std::uint16_t envelope_flags = read_uint16_le_from_bytes(body_pointer + 2);
  const std::uint32_t request_id = read_uint32_le_from_bytes(body_pointer + 4);
  const std::uint32_t payload_length = read_uint32_le_from_bytes(body_pointer + 8);

  if (payload_length + k_envelope_byte_length != body_byte_length) {
    out_error_code = DecodeFrameErrorCode::PAYLOAD_LENGTH_INCONSISTENT;
    return false;
  }

  if (codec_id != k_codec_id_json_utf8) {
    out_error_code = DecodeFrameErrorCode::UNSUPPORTED_CODEC_ID;
    return false;
  }

  out_decoded_frame.sequence = sequence;
  out_decoded_frame.message_kind = static_cast<MessageKind>(message_kind_byte);
  out_decoded_frame.codec_id = codec_id;
  out_decoded_frame.envelope_flags = envelope_flags;
  out_decoded_frame.request_id = request_id;
  out_decoded_frame.payload_utf8_bytes.assign(
      body_pointer + k_envelope_byte_length,
      body_pointer + k_envelope_byte_length + payload_length);
  return true;
}

inline std::vector<std::uint8_t> encode_kibo_device_protocol_v1_frame_or_throw(
    std::uint32_t sequence,
    std::uint32_t request_id,
    MessageKind message_kind,
    const std::vector<std::uint8_t>& payload_utf8_bytes,
    std::uint8_t codec_id = k_codec_id_json_utf8,
    std::uint16_t envelope_flags = 0
) {
  if (codec_id != k_codec_id_json_utf8) {
    throw std::runtime_error("unsupported codec_id");
  }

  const std::uint32_t payload_length = static_cast<std::uint32_t>(payload_utf8_bytes.size());
  const std::uint32_t body_byte_length = static_cast<std::uint32_t>(k_envelope_byte_length + payload_length);

  std::vector<std::uint8_t> frame;
  frame.resize(k_frame_header_byte_length + body_byte_length + 4);

  std::uint8_t* header_pointer = frame.data();
  for (std::size_t index = 0; index < k_frame_magic_byte_length; index += 1) {
    header_pointer[index] = k_frame_magic_bytes.at(index);
  }
  write_uint16_le_to_bytes(header_pointer + 4, k_protocol_version_u16_le);
  write_uint16_le_to_bytes(header_pointer + 6, 0);
  write_uint32_le_to_bytes(header_pointer + 8, sequence);
  write_uint32_le_to_bytes(header_pointer + 12, body_byte_length);
  write_uint32_le_to_bytes(header_pointer + 16, 0);

  const std::uint32_t header_crc =
      kibo::runtime::compute_crc32_over_bytes(header_pointer, k_header_crc_input_byte_length);
  write_uint32_le_to_bytes(header_pointer + 16, header_crc);

  std::uint8_t* body_pointer = frame.data() + k_frame_header_byte_length;
  body_pointer[0] = static_cast<std::uint8_t>(message_kind);
  body_pointer[1] = codec_id;
  write_uint16_le_to_bytes(body_pointer + 2, envelope_flags);
  write_uint32_le_to_bytes(body_pointer + 4, request_id);
  write_uint32_le_to_bytes(body_pointer + 8, payload_length);
  for (std::size_t index = 0; index < payload_utf8_bytes.size(); index += 1) {
    body_pointer[k_envelope_byte_length + index] = payload_utf8_bytes.at(index);
  }

  const std::uint32_t body_crc =
      kibo::runtime::compute_crc32_over_bytes(body_pointer, body_byte_length);
  write_uint32_le_to_bytes(body_pointer + body_byte_length, body_crc);

  return frame;
}

}  // namespace kibo::device_protocol::v1
