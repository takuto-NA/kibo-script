import type { DeviceAddress } from "../core/device-address";
import type { DeviceEffect, DeviceReadRequest, SimulationDevice } from "../core/device-bus";
import type { ScriptValue } from "../core/value";
import { booleanValue, stringValue } from "../core/value";

/**
 * Simulated digital button input button#N。
 */
export class ButtonDevice implements SimulationDevice {
  private readonly address: DeviceAddress;
  private isPressed: boolean;

  public constructor(address: DeviceAddress, initiallyPressed: boolean) {
    this.address = address;
    this.isPressed = initiallyPressed;
  }

  public isPressedState(): boolean {
    return this.isPressed;
  }

  public getDeviceId(): number {
    return this.address.id;
  }

  /**
   * UI / embed / テストが押下状態を注入する。
   */
  public setSimulatedPressed(nextPressed: boolean): void {
    this.isPressed = nextPressed;
  }

  public readProperty(request: DeviceReadRequest): ScriptValue | undefined {
    if (request.property === "info") {
      const text = `kind: button
id: ${this.address.id}
pressed: ${this.isPressed}`;
      return stringValue(text);
    }
    if (request.property === "pressed" || request.property === "") {
      return booleanValue(this.isPressed);
    }
    return undefined;
  }

  public applyEffect(_effect: DeviceEffect): void {
    // button は MVP ではホストからの effect はない
  }
}
