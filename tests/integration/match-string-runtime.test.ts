import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";

describe("match string runtime", () => {
  it("runs only the matched arm when the state matches a string case", () => {
    const sourceText = `var command = "on"

task apply on button#0.pressed {
  match command {
    "on" => { do led#0.on() }
    "off" => { do led#0.off() }
    else => { do led#0.off() }
  }
}
`;
    const compileResult = compileScript(sourceText, "match-on.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const runtime = new SimulationRuntime({ tasks: new TaskRegistry() });
    runtime.replaceCompiledProgram(compileResult.program);
    const led = runtime.getDefaultDevices().led0;

    expect(led.isOn()).toBe(false);

    runtime.dispatchScriptEvent({
      deviceAddress: { kind: "button", id: 0 },
      eventName: "pressed",
    });

    expect(led.isOn()).toBe(true);
  });

  it("runs else when no string case matches", () => {
    const sourceText = `var command = "unknown"

task apply on button#0.pressed {
  match command {
    "on" => { do led#0.on() }
    else => { do serial#0.println("ELSE") }
  }
}
`;
    const compileResult = compileScript(sourceText, "match-else.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const runtime = new SimulationRuntime({ tasks: new TaskRegistry() });
    runtime.replaceCompiledProgram(compileResult.program);
    const serial = runtime.getDefaultDevices().serial0;

    runtime.dispatchScriptEvent({
      deviceAddress: { kind: "button", id: 0 },
      eventName: "pressed",
    });

    const outputLines = serial.takeOutputLines();
    expect(outputLines).toEqual(["ELSE"]);
  });
});
