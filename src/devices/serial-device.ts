import type { DeviceAddress } from "../core/device-address";
import type { DeviceEffect, DeviceReadRequest, SimulationDevice } from "../core/device-bus";
import type { ScriptValue } from "../core/value";
import { booleanValue, stringValue } from "../core/value";

/**
 * Host-facing serial#N: line-oriented stdin/stdout for interactive shell.
 */
export class SerialDevice implements SimulationDevice {
  private readonly address: DeviceAddress;
  private readonly outputLines: string[] = [];
  private readonly pendingInputLines: string[] = [];
  private lineReady: boolean;
  private drained: boolean;

  public constructor(address: DeviceAddress) {
    this.address = address;
    this.lineReady = false;
    this.drained = true;
  }

  public enqueueHostLine(line: string): void {
    this.pendingInputLines.push(line);
    this.lineReady = this.pendingInputLines.length > 0;
  }

  public peekLineReady(): boolean {
    return this.lineReady;
  }

  public readProperty(request: DeviceReadRequest): ScriptValue | undefined {
    if (request.property === "line") {
      const next = this.pendingInputLines.shift();
      this.lineReady = this.pendingInputLines.length > 0;
      if (next === undefined) {
        return stringValue("");
      }
      return stringValue(next);
    }
    if (request.property === "line_ready") {
      return booleanValue(this.lineReady);
    }
    if (request.property === "drained") {
      return booleanValue(this.drained);
    }
    if (request.property === "info") {
      const text = `kind: serial
id: ${this.address.id}
role: host`;
      return stringValue(text);
    }
    return undefined;
  }

  public applyEffect(effect: DeviceEffect): void {
    if (effect.kind !== "serial.println") {
      return;
    }
    if (effect.address.kind !== this.address.kind || effect.address.id !== this.address.id) {
      return;
    }
    this.outputLines.push(effect.text);
    this.drained = true;
  }

  public getOutputLines(): readonly string[] {
    return this.outputLines;
  }

  public takeOutputLines(): string[] {
    const copy = [...this.outputLines];
    this.outputLines.length = 0;
    return copy;
  }
}
