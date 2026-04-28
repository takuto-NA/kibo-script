import type { DeviceAddress } from "../../core/device-address";
import type { DeviceEffect, DeviceReadRequest, SimulationDevice } from "../../core/device-bus";
import type { ScriptValue } from "../../core/value";
import { stringValue } from "../../core/value";
import { DisplayBuffer128x64 } from "./display-buffer";
import { DISPLAY_HEIGHT_PIXELS, DISPLAY_WIDTH_PIXELS } from "./display-constants";

/**
 * Virtual display#N: 128×64 1-bit buffer; `present` copies draft to visible frame.
 */
export class DisplayDevice implements SimulationDevice {
  private readonly address: DeviceAddress;
  private readonly draftBuffer: DisplayBuffer128x64;
  private readonly presentedBuffer: DisplayBuffer128x64;
  private recentEffects: DeviceEffect[] = [];

  public constructor(address: DeviceAddress) {
    this.address = address;
    this.draftBuffer = new DisplayBuffer128x64();
    this.presentedBuffer = new DisplayBuffer128x64();
  }

  public readProperty(request: DeviceReadRequest): ScriptValue | undefined {
    if (request.property === "info") {
      const meta = this.draftBuffer.getMetadataForInfo();
      const text = `kind: ${meta.kind}
id: ${this.address.id}
size: ${meta.width}x${meta.height}
pages: ${meta.pages} (page height ${meta.pageHeight}px)`;
      return stringValue(text);
    }
    return undefined;
  }

  public applyEffect(effect: DeviceEffect): void {
    this.recentEffects.push(effect);
    if (effect.kind === "display.clear" && isSameAddress(effect.address, this.address)) {
      this.draftBuffer.clearAllPixelsOff();
      return;
    }
    if (effect.kind === "display.pixel" && isSameAddress(effect.address, this.address)) {
      this.draftBuffer.setPixel(effect.x, effect.y, effect.on);
      return;
    }
    if (effect.kind === "display.line" && isSameAddress(effect.address, this.address)) {
      drawLineBresenham(
        this.draftBuffer,
        effect.x0,
        effect.y0,
        effect.x1,
        effect.y1,
      );
      return;
    }
    if (effect.kind === "display.circle" && isSameAddress(effect.address, this.address)) {
      drawCircleMidpoint(
        this.draftBuffer,
        effect.centerX,
        effect.centerY,
        effect.radius,
      );
      return;
    }
    if (effect.kind === "display.present" && isSameAddress(effect.address, this.address)) {
      this.presentedBuffer.copyFrom(this.draftBuffer.getFrameBytes());
    }
  }

  public getPresentedFrameBytes(): Uint8Array {
    return this.presentedBuffer.getFrameBytes();
  }

  public getDraftFrameBytes(): Uint8Array {
    return this.draftBuffer.getFrameBytes();
  }

  public drainRecentEffects(): DeviceEffect[] {
    const copy = this.recentEffects;
    this.recentEffects = [];
    return copy;
  }
}

function isSameAddress(a: DeviceAddress, b: DeviceAddress): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function drawLineBresenham(
  buffer: DisplayBuffer128x64,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  let currentX = x0;
  let currentY = y0;
  const deltaX = Math.abs(x1 - x0);
  const deltaY = -Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let error = deltaX + deltaY;
  for (;;) {
    buffer.setPixel(currentX, currentY, true);
    if (currentX === x1 && currentY === y1) {
      break;
    }
    const doubleError = 2 * error;
    if (doubleError >= deltaY) {
      error += deltaY;
      currentX += stepX;
    }
    if (doubleError <= deltaX) {
      error += deltaX;
      currentY += stepY;
    }
  }
}

function drawCircleMidpoint(
  buffer: DisplayBuffer128x64,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  if (radius < 0) {
    return;
  }
  let x = 0;
  let y = radius;
  let decision = 1 - radius;
  while (x <= y) {
    plotCirclePoints(buffer, centerX, centerY, x, y);
    x += 1;
    if (decision < 0) {
      decision += 2 * x + 1;
    } else {
      y -= 1;
      decision += 2 * (x - y) + 1;
    }
  }
}

function plotCirclePoints(
  buffer: DisplayBuffer128x64,
  centerX: number,
  centerY: number,
  x: number,
  y: number,
): void {
  buffer.setPixel(centerX + x, centerY + y, true);
  buffer.setPixel(centerX - x, centerY + y, true);
  buffer.setPixel(centerX + x, centerY - y, true);
  buffer.setPixel(centerX - x, centerY - y, true);
  buffer.setPixel(centerX + y, centerY + x, true);
  buffer.setPixel(centerX - y, centerY + x, true);
  buffer.setPixel(centerX + y, centerY - x, true);
  buffer.setPixel(centerX - y, centerY - x, true);
}

export function isCoordinateInDisplayRange(x: number, y: number): boolean {
  return (
    x >= 0 &&
    x < DISPLAY_WIDTH_PIXELS &&
    y >= 0 &&
    y < DISPLAY_HEIGHT_PIXELS
  );
}
