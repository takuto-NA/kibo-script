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

- `KIBO_PKG` の `schema=1` は **1 行 frame の JSON package 形式**（CRC + Base64）を指す。
- 受信結果は `kibo_pkg_ack status=ok` または `kibo_pkg_ack status=error reason=...` で返る。
- firmware が応答する `kibo_loader ... protocol=1` の **`protocol=1` は loader handshake / USB line protocol の版**であり、`KIBO_PKG schema=1` とは別物（ただし同じ “protocol version = 1” 世代のツールチェーン前提）。

## Loader handshake（`KIBO_PING`）

Host 側 CLI（`pico_link_doctor.py` / `upload_pico_runtime_package.py` の preflight）は、package を送る前に次の 1 行を送る。

```text
KIBO_PING
```

loader firmware が有効なら、次の 1 行が返る。

```text
kibo_loader status=ok protocol=1 active=<fixture or loaded-package>
```

- 旧 firmware は `KIBO_PING` に応答しないため、doctor は **loader 未導入**と判定できる。
- boot 時の `kibo_pico_vertical_slice_boot ... loader_protocol=1` も同じ世代の目印。

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

事前診断（loader / port / BOOTSEL）:

```powershell
& $picoVenvPython scripts\pico\runtime_vertical_slice\tools\pico_link_doctor.py --port auto
```

`pyserial` が入った venv の Pythonで:

```powershell
& $picoVenvPython scripts\pico\runtime_vertical_slice\tools\check_pico_baseline.py --port COM11 --capture-seconds 8 --expected-trace-file tests\runtime-conformance\golden\circle-animation.conformance.trace.txt
```

## 初回 loader 導入（BOOTSEL / UF2）

```powershell
& $picoVenvPython scripts\pico\runtime_vertical_slice\tools\install_pico_loader.py --repo-root . --port auto
```

## runtime IR -> PicoRuntimePackage（repo ルートで npm install 済み前提）

```powershell
npm run build-pico-runtime-package -- --input path\to\kibo-runtime-ir-contract.json --output path\to\package.json
```

source script から直接 package 化する場合:

```powershell
npm run build-pico-runtime-package-from-script -- --input-script examples\pico-runtime-samples\circle-sweep.sc --output .pico-work\circle-sweep.pico-runtime-package.json --trace-var circle_x
```

## 一発リンク確認（source script / package / runtime IR）

```powershell
& $picoVenvPython scripts\pico\runtime_vertical_slice\tools\pico_link_check.py --port auto --source-script examples\pico-runtime-samples\circle-sweep.sc --trace-var circle_x
```

`pico_link_check.py` は TypeScript runtime で期待 trace を生成し、その package を Pico へ upload したあと、実機 serial trace に同じ sequence が含まれることを確認する。

## Pico runtime samples

`examples/pico-runtime-samples/` には、現時点の Pico vertical slice が実行できる最小サンプルを置いている。

- `led-heartbeat.sc`: `led#0.toggle()` を 500ms ごとに実行する。
- `circle-sweep.sc`: OLED 上の円を右へ動かし、`circle_x` も trace する。
- `two-circle-chase.sc`: 2 つの円を異なる速度で動かし、複数 var / 複数 circle draw を確認する。
- `growing-circle.sc`: 中央円の半径を増やす。
- `button-led-toggle.sc`: replay で `button#0.pressed` を dispatch し、LED toggle を確認する。

実機へ順に流して simulator replay trace と比較する:

```powershell
& $picoVenvPython scripts\pico\runtime_vertical_slice\tools\run_pico_runtime_samples.py --port auto --repo-root .
```

## Simulator UI から Pico へ書き込む

Chrome / Edge の localhost など Web Serial が使える環境では、script runner に `Run simulator & write to Pico` ボタンが表示される。

ボタンは現在の script を reset compile して simulator に反映し、同じ compiled program から `PicoRuntimePackage` を作り、ブラウザの serial port chooser で選んだ Pico へ `KIBO_PING` / `KIBO_PKG` を送る。最後に Pico の serial trace が TypeScript replay trace と一致するか確認する。

Web Serial が使えないブラウザではボタンは無効化される。その場合は上記の `pico_link_check.py --source-script ...` を使う。

## package の転送（開発用）

```powershell
& $picoVenvPython scripts\pico\runtime_vertical_slice\tools\upload_pico_runtime_package.py --port auto --package-file tests\runtime-conformance\golden\pico-runtime-packages\blink-led.pico-runtime-package.json
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
