# 責務: `runtime/pico/vertical_slice` のビルド方法と、USB Serial trace の取り方を記す。

## 何をする firmware か

- `tests/runtime-conformance/golden/circle-animation.runtime-ir-contract.json` と同一内容の runtime IR を **埋め込み文字列**として保持し、起動時に `KiboHostRuntime`（`runtime/cpp`）で replay steps を実行する。
- `collect_trace` のたびに `trace ...` 行を USB Serial へ出す（acceptance 用）。
- OLED（`GP16`/`GP17`）では、同じ `circle-animation` IR を live runtime として 100ms ごとに tick し、円が右へ動いて見えるようにする。
- USB CDC の attach 遅れで起動直後の trace を取りこぼさないよう、`loop()` でも約 5 秒ごとに同じ trace sequence を再送する。
- Circle は画面外へ出ると分かりにくいため、live runtime は約 3.2 秒ごとにリセットして再び左側から動かす。
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

## 実機確認メモ

- `pio run` は成功し、Flash 約 20.4%、RAM 約 6.9%。
- `pio run -t upload` は BOOTSEL には入ったが、Windows の `picotool` driver 権限で失敗したため、`RPI-RP2` ドライブへ `firmware.uf2` をコピーして書き込んだ。
- 書き込み後は USB Serial が `COM11` として再認識され、次の trace 3 行が繰り返し出ることを確認した。

```text
trace schema=1 sim_ms=0 led0=0 btn0=0 dpy_fp=b9d103fd6854a325 vars=circle_x=20 sm=-
trace schema=1 sim_ms=100 led0=0 btn0=0 dpy_fp=abb0ec954afd3205 vars=circle_x=24 sm=-
trace schema=1 sim_ms=200 led0=0 btn0=0 dpy_fp=317a917e19c73405 vars=circle_x=28 sm=-
```
