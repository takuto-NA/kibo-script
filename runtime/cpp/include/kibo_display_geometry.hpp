#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace kibo::runtime {

inline constexpr int kDisplayWidthPixels = 128;
inline constexpr int kDisplayHeightPixels = 64;
inline constexpr std::size_t kDisplayPixelCount =
    static_cast<std::size_t>(kDisplayWidthPixels) * static_cast<std::size_t>(kDisplayHeightPixels);

inline bool is_inside_display_range(int x, int y) {
  if (x < 0) {
    return false;
  }
  if (y < 0) {
    return false;
  }
  if (x >= kDisplayWidthPixels) {
    return false;
  }
  if (y >= kDisplayHeightPixels) {
    return false;
  }
  return true;
}

inline int pixel_index(int x, int y) {
  return y * kDisplayWidthPixels + x;
}

inline void set_pixel(std::array<std::uint8_t, kDisplayPixelCount>& pixels, int x, int y, bool enabled) {
  if (!is_inside_display_range(x, y)) {
    return;
  }
  pixels[static_cast<std::size_t>(pixel_index(x, y))] = enabled ? 1 : 0;
}

inline void plot_circle_points(
    std::array<std::uint8_t, kDisplayPixelCount>& pixels,
    int center_x,
    int center_y,
    int x,
    int y
) {
  set_pixel(pixels, center_x + x, center_y + y, true);
  set_pixel(pixels, center_x - x, center_y + y, true);
  set_pixel(pixels, center_x + x, center_y - y, true);
  set_pixel(pixels, center_x - x, center_y - y, true);
  set_pixel(pixels, center_x + y, center_y + x, true);
  set_pixel(pixels, center_x - y, center_y + x, true);
  set_pixel(pixels, center_x + y, center_y - x, true);
  set_pixel(pixels, center_x - y, center_y - x, true);
}

/**
 * 責務: TypeScript `display-device.ts` の `drawCircleMidpoint` と同じ中点円アルゴリズムで draft を更新する。
 */
inline void draw_circle_midpoint(
    std::array<std::uint8_t, kDisplayPixelCount>& pixels,
    int center_x,
    int center_y,
    int radius
) {
  if (radius < 0) {
    return;
  }
  int x = 0;
  int y = radius;
  int decision = 1 - radius;
  while (x <= y) {
    plot_circle_points(pixels, center_x, center_y, x, y);
    x += 1;
    if (decision < 0) {
      decision += 2 * x + 1;
      continue;
    }
    y -= 1;
    decision += 2 * (x - y) + 1;
  }
}

}  // namespace kibo::runtime
