// 責務: minify 後の `PicoRuntimePackage` JSON の UTF-8 サイズを、トップレベルキーごとの値部分木 `JSON.stringify(root[key])` の byte 長で分解する（どのキーが支配的かの原因追求用。部分木の byte 合計は全体 minify と一致しない）。

export type MinifiedUtf8BreakdownRowForTopLevelPackageKey = {
  readonly topLevelJsonKey: string;
  readonly minifiedUtf8ByteCountForValueSubtree: number;
};

export type MinifiedUtf8BreakdownForPicoRuntimePackage = {
  readonly fullMinifiedUtf8ByteCount: number;
  readonly rowsSortedByByteCountDescending: readonly MinifiedUtf8BreakdownRowForTopLevelPackageKey[];
};

function assertIsJsonObjectRoot(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected PicoRuntimePackage JSON root object.");
  }
}

export function breakDownMinifiedPicoRuntimePackageUtf8ByTopLevelKeysOrThrow(params: {
  readonly canonicalPicoRuntimePackageJsonText: string;
}): MinifiedUtf8BreakdownForPicoRuntimePackage {
  const parsedRoot: unknown = JSON.parse(params.canonicalPicoRuntimePackageJsonText);
  assertIsJsonObjectRoot(parsedRoot);

  const fullMinifiedText = JSON.stringify(parsedRoot);
  const fullMinifiedUtf8ByteCount = new TextEncoder().encode(fullMinifiedText).byteLength;

  const topLevelJsonKeys = Object.keys(parsedRoot);
  const rowsUnsorted: MinifiedUtf8BreakdownRowForTopLevelPackageKey[] = topLevelJsonKeys.map(
    (topLevelJsonKey) => {
      const minifiedUtf8ByteCountForValueSubtree = new TextEncoder().encode(
        JSON.stringify(parsedRoot[topLevelJsonKey]),
      ).byteLength;
      return { topLevelJsonKey, minifiedUtf8ByteCountForValueSubtree };
    },
  );

  const rowsSortedByByteCountDescending = [...rowsUnsorted].sort(
    (left, right) => right.minifiedUtf8ByteCountForValueSubtree - left.minifiedUtf8ByteCountForValueSubtree,
  );

  return { fullMinifiedUtf8ByteCount, rowsSortedByByteCountDescending };
}
