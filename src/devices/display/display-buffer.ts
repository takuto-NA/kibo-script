import {
  DISPLAY_HEIGHT_PIXELS,
  DISPLAY_PAGE_COUNT,
  DISPLAY_PAGE_HEIGHT_PIXELS,
  DISPLAY_WIDTH_PIXELS,
  TOTAL_PIXEL_COUNT,
} from "./display-constants";

function pixelIndex(x: number, y: number): number {
  return y * DISPLAY_WIDTH_PIXELS + x;
}

/**
 * 1-bit framebuffer for 128×64 SSD1306-style monochrome display.
 */
export class DisplayBuffer128x64 {
  private readonly pixels: Uint8Array;

  public constructor() {
    this.pixels = new Uint8Array(TOTAL_PIXEL_COUNT);
  }

  public clearAllPixelsOff(): void {
    this.pixels.fill(0);
  }

  public setPixel(x: number, y: number, enabled: boolean): boolean {
    if (!isInsideDisplay(x, y)) {
      return false;
    }
    const index = pixelIndex(x, y);
    this.pixels[index] = enabled ? 1 : 0;
    return true;
  }

  public getPixel(x: number, y: number): boolean | undefined {
    if (!isInsideDisplay(x, y)) {
      return undefined;
    }
    return this.pixels[pixelIndex(x, y)] === 1;
  }

  /**
   * Snapshot of presented frame as packed bits (length TOTAL_PIXEL_COUNT bytes, 0/1 per pixel).
   */
  public getFrameBytes(): Uint8Array {
    return Uint8Array.from(this.pixels);
  }

  public copyFrom(source: Uint8Array): void {
    if (source.length !== TOTAL_PIXEL_COUNT) {
      throw new Error("Display frame byte length mismatch.");
    }
    this.pixels.set(source);
  }

  public getMetadataForInfo(): {
    kind: string;
    width: number;
    height: number;
    pages: number;
    pageHeight: number;
  } {
    return {
      kind: "display",
      width: DISPLAY_WIDTH_PIXELS,
      height: DISPLAY_HEIGHT_PIXELS,
      pages: DISPLAY_PAGE_COUNT,
      pageHeight: DISPLAY_PAGE_HEIGHT_PIXELS,
    };
  }
}

function isInsideDisplay(x: number, y: number): boolean {
  return (
    x >= 0 &&
    x < DISPLAY_WIDTH_PIXELS &&
    y >= 0 &&
    y < DISPLAY_HEIGHT_PIXELS
  );
}
