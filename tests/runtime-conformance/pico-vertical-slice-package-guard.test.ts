// 責務: Pico vertical slice の package builder が、supported subset 外（animator / 不正 state path / 未対応遷移式）を拒否し、state machine subset を受理することを固定する。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileScript } from "../../src/compiler/compile-script";
import type { CompiledProgram } from "../../src/core/executable-task";
import { buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow } from "../../src/runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract";

const tests_runtime_conformance_directory = dirname(fileURLToPath(import.meta.url));
const compiler_fixtures_directory = join(tests_runtime_conformance_directory, "..", "compiler", "fixtures");

function compile_fixture_or_throw(source_file_name: string) {
  const source_path = join(compiler_fixtures_directory, source_file_name);
  const source_text = readFileSync(source_path, "utf-8").replace(/\r\n/g, "\n");
  const compile_result = compileScript(source_text, source_file_name);
  expect(compile_result.ok).toBe(true);
  if (compile_result.ok === false) {
    throw new Error(`compile failed: ${source_file_name}`);
  }
  return compile_result.program;
}

describe("Pico vertical slice package builder supported subset gates", () => {
  it("packages supported state machine programs (membership every)", () => {
    const program = compile_fixture_or_throw("semantics-state-membership-every.sc");
    const package_text = buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow({
      compiledProgram: program,
      scriptVarNamesToIncludeInTraceOverride: ["ticks_in_on"],
    });
    expect(package_text).toContain('"stateMachines"');
    expect(package_text).toContain("ticks_in_on");
  });

  it("rejects programs that include animator definitions", () => {
    const program = compile_fixture_or_throw("fade-animator-linear.sc");
    expect(() =>
      buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow({
        compiledProgram: program,
        scriptVarNamesToIncludeInTraceOverride: undefined,
      }),
    ).toThrow(/animator/i);
  });

  it("rejects stateMembershipPath that does not match any compiled state node prefix", () => {
    const program = compile_fixture_or_throw("semantics-state-membership-every.sc");
    const broken_program: CompiledProgram = structuredClone(program);
    const every_task = broken_program.everyTasks[0];
    if (every_task === undefined) {
      throw new Error("Expected semantics-state-membership-every fixture to declare an every task.");
    }
    every_task.stateMembershipPath = "sm.Nope";
    expect(() =>
      buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow({
        compiledProgram: broken_program,
        scriptVarNamesToIncludeInTraceOverride: ["ticks_in_on"],
      }),
    ).toThrow(/no state node uses that prefix/i);
  });

  it("rejects unsupported expression kinds in state machine transition conditions", () => {
    const program = compile_fixture_or_throw("semantics-state-membership-every.sc");
    const broken_program: CompiledProgram = structuredClone(program);
    const off_node = broken_program.stateMachines[0]?.nodes.find((node) => node.path === "sm.Off");
    const first_local_transition = off_node?.localTransitions[0];
    if (first_local_transition === undefined) {
      throw new Error("Expected sm.Off local transition in semantics-state-membership-every fixture.");
    }
    first_local_transition.condition = { kind: "step_animator", animatorName: "x" };
    expect(() =>
      buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow({
        compiledProgram: broken_program,
        scriptVarNamesToIncludeInTraceOverride: ["ticks_in_on"],
      }),
    ).toThrow(/state machine transition conditions/i);
  });
});
