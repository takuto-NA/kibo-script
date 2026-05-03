# 責務: C++17 host runtime（`runtime/cpp`）のビルド方法を記す。

## 目的

- `kibo_runtime_replay` は `tests/runtime-conformance/replay-inputs/*.replay.json` を入力に取り、stdout へ `trace ...` 行を出す。
- TypeScript golden と一致することを `tests/runtime-conformance/compare-typescript-cpp-host-runtime-replay.test.ts` で検証する（バイナリがある場合）。

## ビルド（CMake）

単一構成ジェネレータ（Ninja / Unix Makefiles）でも MSVC マルチ構成でも使えるように、`configure` に `-DCMAKE_BUILD_TYPE=Release` を付け、`build` に `--config Release` も併記する（CMake が不適切な方を無視する）。

```powershell
npm run build:host-runtime
```

手動の場合:

```powershell
cmake -S runtime/cpp -B runtime/cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build runtime/cpp/build --config Release --parallel
```

生成物（例）:

- Windows MSVC: `runtime/cpp/build/Release/kibo_runtime_replay.exe`
- Ninja / Unix Makefiles: `runtime/cpp/build/kibo_runtime_replay`

## テスト実行時にバイナリパスを明示する

CMake が入っていない CI では比較テストが skip される。ローカルで強制する場合:

```powershell
$env:KIBO_RUNTIME_REPLAY_EXECUTABLE_PATH = "C:\path\to\kibo_runtime_replay.exe"
npm test
```
