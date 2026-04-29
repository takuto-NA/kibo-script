import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import { registerCompiledProgramOnTaskRegistry } from "../../src/core/register-compiled-program";
import { SimulationRuntime } from "../../src/core/simulation-runtime";
import { TaskRegistry } from "../../src/core/task-registry";
import { NoopPhysicsWorld } from "../../src/physics/noop-physics-world";

describe("physics MVP runtime", () => {
  it("applies motor.power and reads imu roll after tick", () => {
    const sourceText = `task drive every 10ms {
  do motor#0.power(25)
  do motor#1.power(-10)
  do servo#0.angle(45)
}
`;
    const compileResult = compileScript(sourceText, "rc.sc");
    expect(compileResult.ok).toBe(true);
    if (compileResult.ok === false) {
      return;
    }

    const physicsWorld = new NoopPhysicsWorld();
    const taskRegistry = new TaskRegistry();
    registerCompiledProgramOnTaskRegistry({
      taskRegistry,
      compiledProgram: compileResult.program,
    });
    const runtime = new SimulationRuntime({ tasks: taskRegistry, physicsWorld });
    runtime.tick(10);

    expect(physicsWorld.getMotorPowerPercent(0)).toBe(25);
    expect(physicsWorld.getMotorPowerPercent(1)).toBe(-10);
    expect(physicsWorld.getServoAngleDegrees(0)).toBe(45);
    const roll = runtime.getDeviceBus().read({ address: { kind: "imu", id: 0 }, property: "roll" });
    expect(roll?.tag).toBe("integer");
    if (roll?.tag === "integer") {
      expect(roll.value).toBe(0);
    }
  });
});
