// 責務: `PicoRuntimePackage` JSON から TypeScript 側 replay を実行し、期待 conformance trace 行を stdout に 1 行ずつ出す（`pico_link_check` 等が利用）。

import { readFileSync } from "node:fs";
import {
  extractReplayInputsFromPicoRuntimePackageUnknownJsonOrThrow,
} from "../../../../src/runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract";
import { executeRuntimeConformanceReplayStepsAndCollectTraceLines } from "../../../../src/runtime-conformance/execute-runtime-conformance-replay-steps-and-collect-trace-lines";

function parse_cli_arguments_or_exit(argv: readonly string[]): { readonly packageFilePath: string } {
  let packageFilePath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--package-file") {
      packageFilePath = argv[index + 1];
      index += 1;
      continue;
    }
    console.error(`Unknown argument: ${token}`);
    process.exit(2);
  }
  if (packageFilePath === undefined) {
    console.error("Usage: print_expected_conformance_trace_lines_from_pico_runtime_package_cli.ts --package-file <pico-runtime-package.json>");
    process.exit(2);
  }
  return { packageFilePath };
}

function main(): void {
  const cli = parse_cli_arguments_or_exit(process.argv.slice(2));
  const packageText = readFileSync(cli.packageFilePath, "utf-8");
  const packageRoot: unknown = JSON.parse(packageText);
  const replayInputs = extractReplayInputsFromPicoRuntimePackageUnknownJsonOrThrow(packageRoot);
  const traceLines = executeRuntimeConformanceReplayStepsAndCollectTraceLines({
    compiledProgram: replayInputs.compiledProgram,
    scriptVarNamesToIncludeInTrace: replayInputs.scriptVarNamesToIncludeInTrace,
    replaySteps: replayInputs.replaySteps,
  });
  for (const line of traceLines) {
    console.log(line);
  }
}

main();
