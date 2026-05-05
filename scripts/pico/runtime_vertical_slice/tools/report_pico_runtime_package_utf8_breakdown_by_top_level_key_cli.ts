// 責務: `examples/pico-runtime-samples/samples.json` の各サンプルについて、minify 後 package の UTF-8 をトップレベル JSON キー別に出力する（原因追求・ドキュメント表の再現用）。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScript } from "../../../../src/compiler/compile-script";
import { buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow } from "../../../../src/runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract";
import { breakDownMinifiedPicoRuntimePackageUtf8ByTopLevelKeysOrThrow } from "../../../../src/runtime-conformance/break-down-minified-pico-runtime-package-utf8-by-top-level-keys";

type SampleManifest = {
  readonly samples: readonly {
    readonly name: string;
    readonly sourceFile: string;
    readonly traceVars: readonly string[];
  }[];
};

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRootDirectory = join(toolsDirectory, "..", "..", "..", "..");
const samplesDirectory = join(repositoryRootDirectory, "examples", "pico-runtime-samples");
const samplesManifestPath = join(samplesDirectory, "samples.json");

function parseOptionalSampleNameFilterFromArgv(argv: readonly string[]): string | undefined {
  const sampleFlagIndex = argv.indexOf("--sample");
  if (sampleFlagIndex === -1) {
    return undefined;
  }
  const sampleNameToken = argv[sampleFlagIndex + 1];
  if (sampleNameToken === undefined || sampleNameToken.length === 0) {
    throw new Error("Missing value after --sample.");
  }
  return sampleNameToken;
}

function printBreakdownForOneSample(params: {
  readonly sampleName: string;
  readonly packageCanonicalJsonText: string;
}): void {
  const breakdown = breakDownMinifiedPicoRuntimePackageUtf8ByTopLevelKeysOrThrow({
    canonicalPicoRuntimePackageJsonText: params.packageCanonicalJsonText,
  });
  console.log(`sample=${params.sampleName} full_minified_utf8_bytes=${breakdown.fullMinifiedUtf8ByteCount}`);
  for (const row of breakdown.rowsSortedByByteCountDescending) {
    const fractionPercent =
      breakdown.fullMinifiedUtf8ByteCount === 0
        ? 0
        : (100 * row.minifiedUtf8ByteCountForValueSubtree) / breakdown.fullMinifiedUtf8ByteCount;
    console.log(
      `  key=${row.topLevelJsonKey} value_subtree_utf8_bytes=${row.minifiedUtf8ByteCountForValueSubtree} approx_percent_of_full=${fractionPercent.toFixed(1)}`,
    );
  }
}

const argv = process.argv.slice(2);
const optionalSampleNameFilter = parseOptionalSampleNameFilterFromArgv(argv);

const manifestText = readFileSync(samplesManifestPath, "utf-8");
const manifest = JSON.parse(manifestText) as SampleManifest;

for (const sample of manifest.samples) {
  if (optionalSampleNameFilter !== undefined && sample.name !== optionalSampleNameFilter) {
    continue;
  }

  const sourcePath = join(samplesDirectory, sample.sourceFile);
  const sourceText = readFileSync(sourcePath, "utf-8").replace(/\r\n/g, "\n");
  const compileResult = compileScript(sourceText, sample.sourceFile);
  if (compileResult.ok === false) {
    console.error(`compile_failed sample=${sample.name}`);
    process.exitCode = 1;
    continue;
  }

  const packageText = buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow({
    compiledProgram: compileResult.program,
    scriptVarNamesToIncludeInTraceOverride: sample.traceVars,
  });
  printBreakdownForOneSample({ sampleName: sample.name, packageCanonicalJsonText: packageText });
}

if (optionalSampleNameFilter !== undefined) {
  const matched = manifest.samples.some((sample) => sample.name === optionalSampleNameFilter);
  if (matched === false) {
    console.error(`Unknown sample name: ${optionalSampleNameFilter}`);
    process.exit(1);
  }
}
