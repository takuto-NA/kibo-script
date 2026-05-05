// 責務: `runtime/shared/kibo-glcdfont-5x7-bytes.json` から C++ 用 `kibo_glcdfont_5x7_columns.hpp` を生成する（手編集禁止ヘッダの再生成）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRootDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonPath = path.join(repositoryRootDirectory, "runtime", "shared", "kibo-glcdfont-5x7-bytes.json");
const outPath = path.join(repositoryRootDirectory, "runtime", "cpp", "include", "kibo_glcdfont_5x7_columns.hpp");
const tsOutPath = path.join(
  repositoryRootDirectory,
  "src",
  "devices",
  "display",
  "kibo-glcdfont-5x7-column-bytes.generated.ts",
);

const jsonText = fs.readFileSync(jsonPath, "utf-8");
const parsed = JSON.parse(jsonText);
const flatColumns = parsed.columns.flat();
const body = flatColumns.map((byteValue) => `0x${Number(byteValue).toString(16).padStart(2, "0")}`).join(", ");

const headerText = `// Generated from runtime/shared/kibo-glcdfont-5x7-bytes.json (Adafruit glcdfont). DO NOT EDIT BY HAND.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace kibo::runtime {

inline constexpr std::size_t kGlcdFont5x7GlyphCount = 256;
inline constexpr std::size_t kGlcdFont5x7BytesPerGlyph = 5;
inline constexpr std::array<std::uint8_t, kGlcdFont5x7GlyphCount * kGlcdFont5x7BytesPerGlyph> kGlcdFont5x7ColumnBytes = {
${body}
};

}  // namespace kibo::runtime
`;

fs.writeFileSync(outPath, headerText, "utf-8");
console.log(`OK: wrote ${outPath} (${flatColumns.length} bytes)`);

const tsText = `// Generated from runtime/shared/kibo-glcdfont-5x7-bytes.json by scripts/generate-kibo-glcdfont-hpp.mjs. DO NOT EDIT BY HAND.

/** Adafruit GFX glcdfont: 256 glyphs × 5 column bytes (8 rows, LSB = top row). */
export const KIBO_GLCD_FONT_5X7_COLUMN_BYTES: readonly number[] = [
${flatColumns.join(", ")}
];
`;

fs.writeFileSync(tsOutPath, tsText, "utf-8");
console.log(`OK: wrote ${tsOutPath}`);
