#pragma once

// 責務: Pico vertical slice が受け取る minified `PicoRuntimePackage` UTF-8 の最大バイト数を、ビルド時に上書き可能な単一ソースとして定義する。
//
// Guard: 未指定時は production default `12288`。実験ビルドは PlatformIO の `build_flags` に
// `-DKIBO_PICO_RUNTIME_PACKAGE_MAX_MINIFIED_UTF8_BYTES=<N>` を追加する。`main.cpp` の decode 上限と
// `kibo_device_protocol_v1.hpp` の v1 committed file 上限は必ずこの値と一致させる。

#include <cstddef>

#ifndef KIBO_PICO_RUNTIME_PACKAGE_MAX_MINIFIED_UTF8_BYTES
#define KIBO_PICO_RUNTIME_PACKAGE_MAX_MINIFIED_UTF8_BYTES 12288
#endif

namespace kibo::pico::runtime_package {

inline constexpr std::size_t k_max_minified_utf8_byte_length_for_vertical_slice =
    static_cast<std::size_t>(KIBO_PICO_RUNTIME_PACKAGE_MAX_MINIFIED_UTF8_BYTES);

}  // namespace kibo::pico::runtime_package
