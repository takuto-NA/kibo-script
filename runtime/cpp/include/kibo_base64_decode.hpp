#pragma once

// 責務: Base64（RFC 4648、パディング `=` を含む）をバイト列へデコードする。失敗時は空 vector を返す。

#include <cctype>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace kibo::runtime {

inline int decode_base64_digit_value_or_negative_one(char character) {
  if (character >= 'A' && character <= 'Z') {
    return character - 'A';
  }
  if (character >= 'a' && character <= 'z') {
    return character - 'a' + 26;
  }
  if (character >= '0' && character <= '9') {
    return character - '0' + 52;
  }
  if (character == '+') {
    return 62;
  }
  if (character == '/') {
    return 63;
  }
  return -1;
}

inline std::vector<std::uint8_t> decode_base64_string_to_bytes_or_empty(const std::string& base64_text) {
  std::vector<std::uint8_t> output_bytes;
  if (base64_text.empty()) {
    return output_bytes;
  }

  std::string cleaned_characters;
  cleaned_characters.reserve(base64_text.size());
  for (char character : base64_text) {
    if (std::isspace(static_cast<unsigned char>(character)) != 0) {
      continue;
    }
    cleaned_characters.push_back(character);
  }

  if (cleaned_characters.size() % 4 != 0) {
    return {};
  }

  output_bytes.reserve((cleaned_characters.size() * 3) / 4);

  for (std::size_t index = 0; index < cleaned_characters.size(); index += 4) {
    const int value0 = decode_base64_digit_value_or_negative_one(cleaned_characters[index]);
    const int value1 = decode_base64_digit_value_or_negative_one(cleaned_characters[index + 1]);
    const char third_character = cleaned_characters[index + 2];
    const char fourth_character = cleaned_characters[index + 3];
    const int value2 = third_character == '=' ? 0 : decode_base64_digit_value_or_negative_one(third_character);
    const int value3 = fourth_character == '=' ? 0 : decode_base64_digit_value_or_negative_one(fourth_character);
    if (value0 < 0 || value1 < 0 || value2 < 0 || value3 < 0) {
      return {};
    }

    const std::uint32_t chunk =
        (static_cast<std::uint32_t>(value0) << 18) | (static_cast<std::uint32_t>(value1) << 12) |
        (static_cast<std::uint32_t>(value2) << 6) | static_cast<std::uint32_t>(value3);

    output_bytes.push_back(static_cast<std::uint8_t>((chunk >> 16) & 0xFFU));
    if (third_character != '=') {
      output_bytes.push_back(static_cast<std::uint8_t>((chunk >> 8) & 0xFFU));
    }
    if (fourth_character != '=') {
      output_bytes.push_back(static_cast<std::uint8_t>(chunk & 0xFFU));
    }
  }

  return output_bytes;
}

}  // namespace kibo::runtime
