// 責務: runtime IR contract JSON を読み、`PicoRuntimePackage` の canonical JSON を書き出す CLI（`tsx` 実行を想定）。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPicoRuntimePackageCanonicalJsonTextFromRuntimeIrContractJsonTextOrThrow,
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

function parse_cli_arguments_or_exit(argv: readonly string[]): {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly traceVarNamesOverride: readonly string[] | undefined;
  readonly liveTickIntervalMillisecondsOverride: number | undefined;
  readonly replayPresetId: PicoRuntimePackageReplayPresetId | undefined;
  readonly skipPreflight: boolean;
} {
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let traceVarNamesText: string | undefined;
  let tickMillisecondsText: string | undefined;
  let replayPresetToken: string | undefined;
  let skipPreflight = false;

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

  if (inputPath === undefined || outputPath === undefined) {
    console.error(
      "Usage: build_pico_runtime_package_cli.ts --input <runtime-ir-contract.json> --output <pico-runtime-package.json> " +
        "[--trace-var circle_x,other] [--tick-ms 100] [--replay-preset infer|basic-3-trace|button-toggle-2-press|sample-manifest] [--skip-preflight]",
    );
    process.exit(2);
  }

  const liveTickIntervalMillisecondsOverride =
    tickMillisecondsText === undefined ? undefined : parsePositiveIntegerOrExit("--tick-ms", tickMillisecondsText);

  const replayPresetId = replayPresetToken === undefined ? undefined : parseReplayPresetIdOrExit(replayPresetToken);

  return {
    inputPath,
    outputPath,
    traceVarNamesOverride: splitCommaSeparatedTraceVarNamesOrUndefined(traceVarNamesText),
    liveTickIntervalMillisecondsOverride,
    replayPresetId,
    skipPreflight,
  };
}

function main(): void {
  const cli = parse_cli_arguments_or_exit(process.argv.slice(2));
  const runtimeIrContractJsonText = readFileSync(cli.inputPath, "utf-8");
  const packageText = buildPicoRuntimePackageCanonicalJsonTextFromRuntimeIrContractJsonTextOrThrow({
    runtimeIrContractJsonText,
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
  const uploadHint =
    `Next: upload with pyserial venv Python, for example:\n` +
    `  python scripts/pico/runtime_vertical_slice/tools/upload_pico_runtime_package.py --port auto --package-file ${cli.outputPath}\n` +
    `Or one-shot:\n` +
    `  python scripts/pico/runtime_vertical_slice/tools/pico_link_check.py --port auto --package-file ${cli.outputPath}\n` +
    `Repo root for relative paths: ${repoRootDirectory}`;

  console.log(uploadHint);
}

main();
