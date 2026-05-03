// 責務: `replay.json` を C++ `kibo_runtime_replay` に渡した stdout trace が、TypeScript golden trace と一致することを確認する（CMake でビルドしたバイナリがある環境のみ）。

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testsRuntimeConformanceDirectory = dirname(fileURLToPath(import.meta.url));
const goldenDirectory = join(testsRuntimeConformanceDirectory, "golden");
const replayInputsDirectory = join(testsRuntimeConformanceDirectory, "replay-inputs");
const repositoryRootDirectory = join(testsRuntimeConformanceDirectory, "..", "..");

function resolve_host_runtime_replay_executable_path_or_undefined(): string | undefined {
  const explicit_executable_path = process.env.KIBO_RUNTIME_REPLAY_EXECUTABLE_PATH;
  if (explicit_executable_path !== undefined && explicit_executable_path.trim().length > 0) {
    if (existsSync(explicit_executable_path)) {
      return explicit_executable_path;
    }
  }

  const candidate_executable_paths = [
    join(repositoryRootDirectory, "runtime", "cpp", "build", "Release", "kibo_runtime_replay.exe"),
    join(repositoryRootDirectory, "runtime", "cpp", "build", "Debug", "kibo_runtime_replay.exe"),
    join(repositoryRootDirectory, "runtime", "cpp", "build", "kibo_runtime_replay.exe"),
    join(repositoryRootDirectory, "runtime", "cpp", "build", "kibo_runtime_replay"),
  ];

  for (const candidate_executable_path of candidate_executable_paths) {
    if (existsSync(candidate_executable_path)) {
      return candidate_executable_path;
    }
  }

  return undefined;
}

function split_non_empty_trace_lines_from_text_file(file_text: string): string[] {
  return file_text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function run_host_runtime_replay_executable_or_throw(params: {
  readonly executable_path: string;
  readonly replay_json_absolute_path: string;
}): string {
  return execFileSync(params.executable_path, [params.replay_json_absolute_path], {
    encoding: "utf-8",
  });
}

const host_runtime_replay_executable_path = resolve_host_runtime_replay_executable_path_or_undefined();

describe("TypeScript golden traces vs C++ host runtime replay", () => {
  it.skipIf(host_runtime_replay_executable_path === undefined)(
    "blink-led.replay.json stdout matches blink-led.conformance.trace.txt",
    () => {
      const replay_json_absolute_path = join(replayInputsDirectory, "blink-led.replay.json");
      const cpp_stdout_text = run_host_runtime_replay_executable_or_throw({
        executable_path: host_runtime_replay_executable_path as string,
        replay_json_absolute_path,
      });
      const golden_trace_text = readFileSync(join(goldenDirectory, "blink-led.conformance.trace.txt"), "utf-8");
      expect(split_non_empty_trace_lines_from_text_file(cpp_stdout_text)).toEqual(
        split_non_empty_trace_lines_from_text_file(golden_trace_text),
      );
    },
  );

  it.skipIf(host_runtime_replay_executable_path === undefined)(
    "button-toggle-on-event.replay.json stdout matches golden trace",
    () => {
      const replay_json_absolute_path = join(replayInputsDirectory, "button-toggle-on-event.replay.json");
      const cpp_stdout_text = run_host_runtime_replay_executable_or_throw({
        executable_path: host_runtime_replay_executable_path as string,
        replay_json_absolute_path,
      });
      const golden_trace_text = readFileSync(
        join(goldenDirectory, "button-toggle-on-event.conformance.trace.txt"),
        "utf-8",
      );
      expect(split_non_empty_trace_lines_from_text_file(cpp_stdout_text)).toEqual(
        split_non_empty_trace_lines_from_text_file(golden_trace_text),
      );
    },
  );

  it.skipIf(host_runtime_replay_executable_path === undefined)(
    "circle-animation.replay.json stdout matches golden trace",
    () => {
      const replay_json_absolute_path = join(replayInputsDirectory, "circle-animation.replay.json");
      const cpp_stdout_text = run_host_runtime_replay_executable_or_throw({
        executable_path: host_runtime_replay_executable_path as string,
        replay_json_absolute_path,
      });
      const golden_trace_text = readFileSync(join(goldenDirectory, "circle-animation.conformance.trace.txt"), "utf-8");
      expect(split_non_empty_trace_lines_from_text_file(cpp_stdout_text)).toEqual(
        split_non_empty_trace_lines_from_text_file(golden_trace_text),
      );
    },
  );
});
