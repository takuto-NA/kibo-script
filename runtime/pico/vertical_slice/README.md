# 責務: `runtime/pico/vertical_slice` のビルド方法と、USB Serial trace / `PicoRuntimePackage` 転送の取り方を記す。

## 何をする firmware か

- 既定では `tests/runtime-conformance/golden/pico-runtime-packages/circle-animation.pico-runtime-package.json` と同一内容の **`PicoRuntimePackage`** を `include/embedded_default_pico_runtime_package.hpp` に **minify 埋め込み**し、起動時に `KiboHostRuntime`（`runtime/cpp`）で replay steps を実行する。
- `collect_trace` のたびに `trace ...` 行を USB Serial へ出す（acceptance 用）。
- OLED（`GP16`/`GP17`）では package 内の `runtimeIrContract` を live runtime として `live.tickIntervalMilliseconds` ごとに tick し、円が右へ動いて見えるようにする。
- USB CDC の attach 遅れで起動直後の trace を取りこぼさないよう、`loop()` でも約 5 秒ごとに同じ trace sequence を再送する。
- Circle は画面外へ出ると分かりにくいため、live runtime は約 3.2 秒ごとにリセットして再び左側から動かす。
- `loop()` は `button#0` 相当として `GP18` をポーリングし、押下の raw レベルをログへ出す（acceptance の補助）。
- **開発用**: USB Serial に次の 1 行 frame を送ると、`PicoRuntimePackage` を RAM 上で差し替えられる（firmware rebuild 不要）。

```text
KIBO_PKG schema=1 bytes=<n> crc32=<8 hex lower> b64=<base64 UTF-8 minified JSON>
```

- 受信結果は `kibo_pkg_ack status=ok` または `kibo_pkg_ack status=error reason=...` で返る。

## ビルド（Windows / PowerShell の例）

`docs/pico-bringup.md` と同様に、PlatformIO は `uv` で作った `.pico-work/venv` に隔離する。
グローバルの `pio` / `platformio` は使わない。

```powershell
$repoRoot = (Get-Location).Path
$picoWorkRoot = Join-Path $repoRoot '.pico-work'
$picoVenvPath = Join-Path $picoWorkRoot 'venv'
$picoVenvPython = Join-Path $picoVenvPath 'Scripts\python.exe'

# 初回だけ実行する。既存の venv がある場合も、依存が足りなければ uv が補完する。
uv venv $picoVenvPath
uv pip install --python $picoVenvPython platformio pyserial

$env:PLATFORMIO_CORE_DIR = Join-Path $picoWorkRoot 'platformio-core'
$env:PLATFORMIO_GLOBALLIB_DIR = Join-Path $picoWorkRoot 'platformio-global-lib'
$env:PLATFORMIO_SETTING_ENABLE_TELEMETRY = 'false'
$pio = Join-Path $picoVenvPath 'Scripts\pio.exe'

Push-Location (Join-Path $repoRoot 'runtime\pico\vertical_slice')
& $pio run
Pop-Location
```

ビルド後、`pio run` の **Flash / RAM 使用量**を前回 baseline と比較する（リグレッション検知用）。

## 実機 baseline（接続直後）

`pyserial` が入った venv の Pythonで:

```powershell
& $picoVenvPython scripts\pico\runtime_vertical_slice\tools\check_pico_baseline.py --port COM11 --capture-seconds 8 --expected-trace-file tests\runtime-conformance\golden\circle-animation.conformance.trace.txt
```

## package の転送（開発用）

```powershell
& $picoVenvPython scripts\pico\runtime_vertical_slice\tools\upload_pico_runtime_package.py --port COM11 --package-file tests\runtime-conformance\golden\pico-runtime-packages\blink-led.pico-runtime-package.json
```

## 一括 hardware acceptance（任意）

Node.js と `pyserial` が必要。`--port` を実機の COM に合わせる。

```powershell
& $picoVenvPython scripts\pico\runtime_vertical_slice\tools\run_mvp_hardware_acceptance.py --port COM11 --repo-root .
```

## negative gate（長さ不一致）

```powershell
& $picoVenvPython scripts\pico\runtime_vertical_slice\tools\send_invalid_kibo_pkg_length.py --port COM11
```

## golden 埋め込みの更新手順

1. TypeScript 側で `tests/runtime-conformance/golden/pico-runtime-packages/circle-animation.pico-runtime-package.json` を更新する（`KIBO_WRITE_RUNTIME_CONFORMANCE_GOLDENS=1` で Vitest から書き出し可）。
2. 次を実行して minify JSON を作る（例）:

```powershell
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('tests/runtime-conformance/golden/pico-runtime-packages/circle-animation.pico-runtime-package.json','utf8'));console.log(JSON.stringify(j));"
```

3. 出力文字列を `include/embedded_default_pico_runtime_package.hpp` の raw string に反映する。

## USB Serial trace の比較

`scripts/pico/runtime_vertical_slice/tools/compare_usb_serial_trace_lines.mjs` を参照。

## 表示と trace の役割

この firmware では、**見た目の分かりやすさ**と **conformance の安定性**を分けている。

- OLED 表示: active package の `runtimeIrContract` を live runtime として tick し、円が右へ動いて見える。約 3.2 秒ごとに runtime をリセットし、左側から再開する。
- USB Serial trace: acceptance 用に、active package の replay steps に従った trace sequence を出す。約 5 秒ごとに再送するため、Serial attach が遅れても確認できる。

`packageSchemaVersion` や IR が Pico runtime 未対応の場合は `kibo_pkg_ack status=error` となり、**active package は更新されない**（dry-run で検証してから commit する）。

## 実機確認メモ

確認日: 2026-05-04

- `pio run` は成功し、直近ビルドでは Flash 約 21.3%、RAM 約 7.0%（ツールチェーン更新で変動し得る）。
- `pio run -t upload` は Windows の `picotool` driver 権限で失敗することがあるため、`RPI-RP2` ドライブへ `firmware.uf2` をコピーする手順を正とする。

代表 capture:

```powershell
& $picoVenvPython scripts\pico\cpp17_probe\tools\capture_serial_log.py --port COM11 --baud 115200 --seconds 8
```
