// 責務: `CompiledProgram` を Pico / C++ host runtime が読める **runtime IR contract** として、決定的な JSON テキストへ直列化する。
//
// 注意:
// - compiler golden 用の [`tests/compiler/serialize-compiler-output.ts`](../tests/compiler/serialize-compiler-output.ts) とは別物である。
// - オブジェクトキーは辞書順に並べ替え、浮動小数は使わない前提で `JSON.stringify` の出力を安定化する。

import type { CompiledProgram } from "../core/executable-task";

export const RUNTIME_IR_CONTRACT_SCHEMA_VERSION = 1 as const;

export function sortJsonCompatibleValueByKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((element) => sortJsonCompatibleValueByKeysDeep(element));
  }
  if (typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort((left, right) => left.localeCompare(right));
  const sortedObject: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sortedObject[key] = sortJsonCompatibleValueByKeysDeep(record[key]);
  }
  return sortedObject;
}

export function serializeCompiledProgramToRuntimeIrContractJsonText(compiledProgram: CompiledProgram): string {
  const contractRoot = {
    runtimeIrContractSchemaVersion: RUNTIME_IR_CONTRACT_SCHEMA_VERSION,
    compiledProgram: sortJsonCompatibleValueByKeysDeep(compiledProgram as unknown as Record<string, unknown>),
  };
  return `${JSON.stringify(contractRoot, undefined, 2)}\n`;
}
