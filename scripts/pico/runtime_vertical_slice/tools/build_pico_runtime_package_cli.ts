// 責務: runtime IR contract JSON を読み、`PicoRuntimePackage` の canonical JSON を書き出す CLI（`tsx` 実行を想定）。

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPicoRuntimePackageCanonicalJsonTextFromRuntimeIrContractJsonTextOrThrow } from "../../../../src/runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract";

const DEFAULT_REPO_ROOT_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

function splitCommaSeparatedTraceVarNamesOrUndefined(traceVarArgument: string | undefined): readonly string[] | undefined {
  if (traceVarArgument === undefined) {
    return undefined;
  }
  const names = traceVarArgument
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    return undefined;
  }
  return names;
}

function parse_cli_arguments_or_exit(argv: readonly string[]): {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly traceVarNamesOverride: readonly string[] | undefined;
} {
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let traceVarNamesText: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      inputPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--output") {
      outputPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--trace-var") {
      traceVarNamesText = argv[index + 1];
      index += 1;
      continue;
    }
    console.error(`Unknown argument: ${token}`);
    process.exit(2);
  }

  if (inputPath === undefined || outputPath === undefined) {
    console.error("Usage: build_pico_runtime_package_cli.ts --input <runtime-ir-contract.json> --output <pico-runtime-package.json> [--trace-var circle_x,other]");
    process.exit(2);
  }

  return {
    inputPath,
    outputPath,
    traceVarNamesOverride: splitCommaSeparatedTraceVarNamesOrUndefined(traceVarNamesText),
  };
}

function main(): void {
  const cli = parse_cli_arguments_or_exit(process.argv.slice(2));
  const runtimeIrContractJsonText = readFileSync(cli.inputPath, "utf-8");
  const packageText = buildPicoRuntimePackageCanonicalJsonTextFromRuntimeIrContractJsonTextOrThrow({
    runtimeIrContractJsonText,
    scriptVarNamesToIncludeInTraceOverride: cli.traceVarNamesOverride,
  });
  writeFileSync(cli.outputPath, packageText, "utf-8");

  const repoRootDirectory = DEFAULT_REPO_ROOT_DIRECTORY.replace(/\\/g, "/");
  const uploadHint =
    `Next: upload with pyserial venv Python, for example:\n` +
    `  python scripts/pico/runtime_vertical_slice/tools/upload_pico_runtime_package.py --port auto --package-file ${cli.outputPath}\n` +
    `Or one-shot:\n` +
    `  python scripts/pico/runtime_vertical_slice/tools/pico_link_check.py --port auto --package-file ${cli.outputPath}\n` +
    `Repo root for relative paths: ${repoRootDirectory}`;

  console.log(uploadHint);
}

main();
