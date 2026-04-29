/**
 * interactive shell と compile 経路のギャップを、実装前後で比較できるようにする現状テスト。
 */

import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { parseInteractiveCommandLine } from "../../src/interactive/parse-interactive-command";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";
import { TerminalSession } from "../../src/interactive/terminal-session";

describe("interactive gap characterization", () => {
  it("compileScript LED blink path succeeds", () => {
    const sourceText = `ref led = led#0

task blink every 1000ms {
  do led.toggle()
}
`;
    const result = compileScript(sourceText, "blink.sc");
    expect(result.ok).toBe(true);
  });

  it("interactive parser accepts do led#0.toggle()", () => {
    const parsed = parseInteractiveCommandLine("do led#0.toggle()");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.command.kind).toBe("do_led_effect");
      if (parsed.command.kind === "do_led_effect") {
        expect(parsed.command.ledId).toBe(0);
        expect(parsed.command.ledEffect).toBe("toggle");
      }
    }
  });

  it("interactive task every body runs LED toggle on accumulateTicks when compiled from body", () => {
    const tasks = new TaskRegistry();
    const runtime = new SimulationRuntime({ tasks });
    const session = new TerminalSession(runtime);

    session.submitLine("task blink every 100ms { do led#0.toggle() }");
    const ledDevice = runtime.getDefaultDevices().led0;
    expect(ledDevice.isOn()).toBe(false);

    runtime.tick(99);
    expect(ledDevice.isOn()).toBe(false);

    runtime.tick(1);
    expect(ledDevice.isOn()).toBe(true);

    runtime.tick(100);
    expect(ledDevice.isOn()).toBe(false);
  });
});
