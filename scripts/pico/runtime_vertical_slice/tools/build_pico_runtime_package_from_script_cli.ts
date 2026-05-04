// 責務: Kibo Script source (`.sc`) を compile し、Pico vertical slice で実行できる `PicoRuntimePackage` canonical JSON を書き出す CLI（`tsx` 実行を想定）。

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScript } from "../../../../src/compiler/compile-script";
import { buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow } from "../../../../src/runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract";

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

function parseCliArgumentsOrExit(argv: readonly string[]): {
  readonly inputScriptPath: string;
  readonly outputPath: string;
  readonly traceVarNamesOverride: readonly string[] | undefined;
} {
  let inputScriptPath: string | undefined;
  let outputPath: string | undefined;
  let traceVarNamesText: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input-script") {
      inputScriptPath = argv[index + 1];
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

  if (inputScriptPath === undefined || outputPath === undefined) {
    console.error(
      "Usage: build_pico_runtime_package_from_script_cli.ts --input-script <script.sc> --output <pico-runtime-package.json> [--trace-var circle_x,other]",
    );
    process.exit(2);
  }

  return {
    inputScriptPath,
    outputPath,
    traceVarNamesOverride: splitCommaSeparatedTraceVarNamesOrUndefined(traceVarNamesText),
  };
}

function main(): void {
  const cli = parseCliArgumentsOrExit(process.argv.slice(2));
  const sourceText = readFileSync(cli.inputScriptPath, "utf-8").replace(/\r\n/g, "\n");
  const sourceFileName = basename(cli.inputScriptPath);
  const compileResult = compileScript(sourceText, sourceFileName);
  if (compileResult.ok === false) {
    console.error(`FAIL: ${sourceFileName} did not compile.`);
    console.error(JSON.stringify(compileResult.report, undefined, 2));
    process.exit(1);
  }

  const packageText = buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow({
    compiledProgram: compileResult.program,
    scriptVarNamesToIncludeInTraceOverride: cli.traceVarNamesOverride,
  });
  writeFileSync(cli.outputPath, packageText, "utf-8");

  const repoRootDirectory = DEFAULT_REPO_ROOT_DIRECTORY.replace(/\\/g, "/");
  console.log(`OK: wrote ${cli.outputPath}`);
  console.log(`Repo root for relative paths: ${repoRootDirectory}`);
}

main();
