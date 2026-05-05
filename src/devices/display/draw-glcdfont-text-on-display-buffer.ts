// 責務: Adafruit GFX `glcdfont`（5 列 × 8 行ビット、LSB が最上段）で `DisplayBuffer128x64` に ASCII テキストを描画する（C++ `KiboHostRuntime` と trace fingerprint を一致させる）。

import { KIBO_GLCD_FONT_5X7_COLUMN_BYTES } from "./kibo-glcdfont-5x7-column-bytes.generated";
import type { DisplayBuffer128x64 } from "./display-buffer";
import { DISPLAY_HEIGHT_PIXELS, DISPLAY_WIDTH_PIXELS } from "./display-constants";

const GLYPH_COLUMN_COUNT = 5;
const GLYPH_ROW_COUNT = 8;
const GLYPH_HORIZONTAL_ADVANCE_PIXELS = 6;

export function drawGlcdFontTextAsciiOnDisplayBuffer(params: {
  readonly buffer: DisplayBuffer128x64;
  readonly originX: number;
  readonly originY: number;
  readonly asciiText: string;
}): void {
  let cursorX = params.originX;
  for (let characterIndex = 0; characterIndex < params.asciiText.length; characterIndex += 1) {
    const codeUnit = params.asciiText.charCodeAt(characterIndex);
    const glyphIndex = codeUnit < 256 ? codeUnit : "?".charCodeAt(0);
    const baseByteIndex = glyphIndex * GLYPH_COLUMN_COUNT;
    for (let columnIndex = 0; columnIndex < GLYPH_COLUMN_COUNT; columnIndex += 1) {
      let columnBits = KIBO_GLCD_FONT_5X7_COLUMN_BYTES[baseByteIndex + columnIndex] ?? 0;
      for (let rowIndex = 0; rowIndex < GLYPH_ROW_COUNT; rowIndex += 1) {
        const isPixelOn = (columnBits & 1) !== 0;
        columnBits >>= 1;
        if (!isPixelOn) {
          continue;
        }
        const pixelX = cursorX + columnIndex;
        const pixelY = params.originY + rowIndex;
        if (pixelX >= 0 && pixelX < DISPLAY_WIDTH_PIXELS && pixelY >= 0 && pixelY < DISPLAY_HEIGHT_PIXELS) {
          params.buffer.setPixel(pixelX, pixelY, true);
        }
      }
    }
    cursorX += GLYPH_HORIZONTAL_ADVANCE_PIXELS;
    if (cursorX >= DISPLAY_WIDTH_PIXELS) {
      break;
    }
  }
}
