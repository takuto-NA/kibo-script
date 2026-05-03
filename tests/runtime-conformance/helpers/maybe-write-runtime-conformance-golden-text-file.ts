// 責務: runtime conformance golden ファイルの更新を、明示的な環境変数でのみ許可する。

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const RUNTIME_CONFORMANCE_GOLDEN_UPDATE_ENVIRONMENT_VARIABLE_NAME = "KIBO_WRITE_RUNTIME_CONFORMANCE_GOLDENS";

export function isRuntimeConformanceGoldenUpdateRequestedFromEnvironment(): boolean {
  return process.env[RUNTIME_CONFORMANCE_GOLDEN_UPDATE_ENVIRONMENT_VARIABLE_NAME] === "1";
}

export function maybeWriteTextFileForRuntimeConformanceGoldenUpdate(params: {
  readonly absoluteFilePath: string;
  readonly fileText: string;
}): void {
  if (!isRuntimeConformanceGoldenUpdateRequestedFromEnvironment()) {
    return;
  }
  mkdirSync(dirname(params.absoluteFilePath), { recursive: true });
  writeFileSync(params.absoluteFilePath, params.fileText, "utf-8");
}
