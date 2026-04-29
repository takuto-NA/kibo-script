import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScript } from "../../src/compiler/compile-script";

const testsCompilerDirectory = dirname(fileURLToPath(import.meta.url));

describe("physics MVP compile", () => {
  it("compiles motor power, servo angle, and imu read", () => {
    const sourceText = `task t every 16ms {
  do motor#0.power(50%)
  do motor#1.power(-30)
  do servo#0.angle(90)
  temp r = read imu#0.roll
  temp p = read imu#0.pitch
  do serial#0.println(r)
}
`;
    const result = compileScript(sourceText, "physics-mvp.sc");
    expect(result.ok).toBe(true);
  });

  it("compiles the physics rover showcase sample", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "physics-rover-showcase.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "physics-rover-showcase.sc");
    expect(result.ok).toBe(true);
  });

  it("compiles the simple physics rover sample", () => {
    const fixturePath = join(testsCompilerDirectory, "fixtures", "physics-rover-simple.sc");
    const sourceText = readFileSync(fixturePath, "utf-8").replace(/\r\n/g, "\n");
    const result = compileScript(sourceText, "physics-rover-simple.sc");
    expect(result.ok).toBe(true);
  });
});
