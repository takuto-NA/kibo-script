# 責務: `runtime/pico/vertical_slice` のビルド方法と、USB Serial trace の取り方を記す。

## 何をする firmware か

- `tests/runtime-conformance/golden/circle-animation.runtime-ir-contract.json` と同一内容の runtime IR を **埋め込み文字列**として保持し、起動時に `KiboHostRuntime`（`runtime/cpp`）で replay steps を実行する。
- `collect_trace` のたびに `trace ...` 行を USB Serial へ出し、SSD1306（`GP16`/`GP17`）へ `presented` framebuffer を反映する。
- `loop()` は `button#0` 相当として `GP18` をポーリングし、押下の raw レベルをログへ出す（acceptance の補助）。

## ビルド（Windows / PowerShell の例）

`docs/pico-bringup.md` と同様に `.pico-work/` を用意し、`pio` をvenvへ隔離する。

```powershell
$repoRoot = (Get-Location).Path
$picoWorkRoot = Join-Path $repoRoot '.pico-work'
$env:PLATFORMIO_CORE_DIR = Join-Path $picoWorkRoot 'platformio-core'
$env:PLATFORMIO_GLOBALLIB_DIR = Join-Path $picoWorkRoot 'platformio-global-lib'
$env:PLATFORMIO_SETTING_ENABLE_TELEMETRY = 'false'
$pio = Join-Path $picoWorkRoot 'venv\Scripts\pio.exe'
Push-Location (Join-Path $repoRoot 'runtime\pico\vertical_slice')
& $pio run
Pop-Location
```

## golden 埋め込みの更新手順

1. TypeScript 側で `circle-animation.runtime-ir-contract.json` golden を更新する。
2. 次を実行して minify JSON を作る（例）:

```powershell
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('tests/runtime-conformance/golden/circle-animation.runtime-ir-contract.json','utf8'));console.log(JSON.stringify(j));"
```

3. 出力文字列を `include/embedded_circle_runtime_ir_contract.hpp` の raw string に反映する。

## USB Serial trace の比較

`scripts/pico/runtime_vertical_slice/tools/compare_usb_serial_trace_lines.mjs` を参照。
