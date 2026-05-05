// 責務: Adafruit GFX `glcdfont`（列ビット、LSB が画面上端）で draft framebuffer に ASCII テキストを描画する（TypeScript `drawGlcdFontTextAsciiOnDisplayBuffer` と一致）。

#pragma once

#include "kibo_display_geometry.hpp"
#include "kibo_glcdfont_5x7_columns.hpp"

#include <array>
#include <cstdint>
#include <string>

namespace kibo::runtime {

inline void draw_glcd_font_text_ascii_on_framebuffer(
    std::array<std::uint8_t, kDisplayPixelCount>& pixels,
    int origin_x,
    int origin_y,
    const std::string& utf8_text
) {
  constexpr int k_glyph_column_count = 5;
  constexpr int k_glyph_row_count = 8;
  constexpr int k_horizontal_advance_pixels = 6;

  int cursor_x = origin_x;
  for (std::size_t character_index = 0; character_index < utf8_text.size(); ++character_index) {
    const auto byte = static_cast<unsigned char>(utf8_text[character_index]);
    int glyph_code = static_cast<int>(byte);
    // Guard: 現状は ASCII のみ（UTF-8 マルチバイトは未対応のため '?' にフォールバック）。
    if (byte >= 128) {
      glyph_code = '?';
    }
    const std::size_t base_byte_index = static_cast<std::size_t>(glyph_code) * kGlcdFont5x7BytesPerGlyph;
    for (int column_index = 0; column_index < k_glyph_column_count; ++column_index) {
      unsigned int column_bits =
          kGlcdFont5x7ColumnBytes.at(base_byte_index + static_cast<std::size_t>(column_index));
      for (int row_index = 0; row_index < k_glyph_row_count; ++row_index) {
        const bool is_pixel_on = (column_bits & 1U) != 0;
        column_bits >>= 1U;
        if (!is_pixel_on) {
          continue;
        }
        set_pixel(pixels, cursor_x + column_index, origin_y + row_index, true);
      }
    }
    cursor_x += k_horizontal_advance_pixels;
    if (cursor_x >= kDisplayWidthPixels) {
      break;
    }
  }
}

}  // namespace kibo::runtime
