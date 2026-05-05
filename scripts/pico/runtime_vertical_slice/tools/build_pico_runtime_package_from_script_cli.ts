// 責務: Kibo Script source (`.sc`) を compile し、Pico vertical slice で実行できる `PicoRuntimePackage` canonical JSON を書き出す CLI（`tsx` 実行を想定）。

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScript } from "../../../../src/compiler/compile-script";
import {
  buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow,
  type PicoRuntimePackageReplayPresetId,
} from "../../../../src/runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract";
import { assessKiboPicoRuntimePackageJsonTextPreflightOrThrow } from "../../../../src/runtime-conformance/kibo-pico-package-preflight";

const DEFAULT_REPO_ROOT_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const ALLOWED_REPLAY_PRESET_IDS: readonly PicoRuntimePackageReplayPresetId[] = [
  "infer",
  "basic-3-trace",
  "button-toggle-2-press",
  "sample-manifest",
];

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

function parseReplayPresetIdOrExit(token: string): PicoRuntimePackageReplayPresetId {
  if ((ALLOWED_REPLAY_PRESET_IDS as readonly string[]).includes(token)) {
    return token as PicoRuntimePackageReplayPresetId;
  }
  console.error(
    `FAIL: --replay-preset must be one of: ${ALLOWED_REPLAY_PRESET_IDS.join(", ")} (got ${token})`,
  );
  process.exit(2);
}

function parsePositiveIntegerOrExit(flagName: string, token: string): number {
  const parsed = Number.parseInt(token, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.error(`FAIL: ${flagName} must be a positive integer (got ${token})`);
    process.exit(2);
  }
  return parsed;
}

function parseCliArgumentsOrExit(argv: readonly string[]): {
  readonly inputScriptPath: string;
  readonly outputPath: string;
  readonly traceVarNamesOverride: readonly string[] | undefined;
  readonly liveTickIntervalMillisecondsOverride: number | undefined;
  readonly replayPresetId: PicoRuntimePackageReplayPresetId | undefined;
  readonly skipPreflight: boolean;
} {
  let inputScriptPath: string | undefined;
  let outputPath: string | undefined;
  let traceVarNamesText: string | undefined;
  let tickMillisecondsText: string | undefined;
  let replayPresetToken: string | undefined;
  let skipPreflight = false;

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
    if (token === "--tick-ms") {
      tickMillisecondsText = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--replay-preset") {
      replayPresetToken = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--skip-preflight") {
      skipPreflight = true;
      continue;
    }
    console.error(`Unknown argument: ${token}`);
    process.exit(2);
  }

  if (inputScriptPath === undefined || outputPath === undefined) {
    console.error(
      "Usage: build_pico_runtime_package_from_script_cli.ts --input-script <script.sc> --output <pico-runtime-package.json> " +
        "[--trace-var circle_x,other] [--tick-ms 100] [--replay-preset infer|basic-3-trace|button-toggle-2-press|sample-manifest] [--skip-preflight]",
    );
    process.exit(2);
  }

  const liveTickIntervalMillisecondsOverride =
    tickMillisecondsText === undefined ? undefined : parsePositiveIntegerOrExit("--tick-ms", tickMillisecondsText);

  const replayPresetId = replayPresetToken === undefined ? undefined : parseReplayPresetIdOrExit(replayPresetToken);

  return {
    inputScriptPath,
    outputPath,
    traceVarNamesOverride: splitCommaSeparatedTraceVarNamesOrUndefined(traceVarNamesText),
    liveTickIntervalMillisecondsOverride,
    replayPresetId,
    skipPreflight,
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
    liveTickIntervalMillisecondsOverride: cli.liveTickIntervalMillisecondsOverride,
    replayPresetId: cli.replayPresetId,
  });

  if (!cli.skipPreflight) {
    const preflight = assessKiboPicoRuntimePackageJsonTextPreflightOrThrow({
      canonicalPicoRuntimePackageJsonText: packageText,
    });
    for (const message of preflight.messages) {
      console.log(`PREFLIGHT: ${message}`);
    }
    if (preflight.severity === "reject") {
      console.error("FAIL: Pico package preflight rejected this build (see PREFLIGHT lines above).");
      process.exit(1);
    }
  }

  writeFileSync(cli.outputPath, packageText, "utf-8");

  const repoRootDirectory = DEFAULT_REPO_ROOT_DIRECTORY.replace(/\\/g, "/");
  console.log(`OK: wrote ${cli.outputPath}`);
  console.log(`Repo root for relative paths: ${repoRootDirectory}`);
}

main();
