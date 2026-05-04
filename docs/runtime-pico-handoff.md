# 責務: Kibo Script runtime / Pico 対応の現在地と次タスクを、次の作業者が迷わないように引き継ぐ。

## 現在地（2026-05-04）

Kibo Script は、TypeScript シミュレーターだけでなく、最小範囲の runtime IR を C++17 runtime で実行し、Pico 実機で確認できるところまで進んでいる。

現時点で成立している縦断:

```text
Kibo Script fixture / browser.sc
  -> TypeScript compiler
  -> versioned runtime IR contract JSON
  -> PicoRuntimePackage JSON（runtime IR + replay steps + traceObservation + live tick）
  -> TypeScript conformance trace
  -> C++17 host runtime replay
  -> Pico vertical slice firmware（埋め込み default package + USB Serial で RAM 差し替え）
  -> USB Serial trace / OLED display
```

シミュレーター UI からは **runtime IR contract の copy/download** と **CLI 手順のヒント**まで。Pico への実送信は **Python uploader + USB Serial** を正とする。

## 実装済み

- `src/runtime-conformance/`
  - runtime IR contract JSON の deterministic serializer
  - **`PicoRuntimePackage` の deterministic serializer**（`build-pico-runtime-package.ts`）
  - conformance trace 行の生成
  - `display#0` presented framebuffer の FNV-1a 64bit fingerprint
  - replay document JSON の生成
- `tests/runtime-conformance/`
  - `blink-led.sc`
  - `button-toggle-on-event.sc`
  - `circle-animation.sc`
  - runtime IR contract golden
  - **`PicoRuntimePackage` golden（`golden/pico-runtime-packages/`）**
  - TypeScript `SimulationRuntime` trace golden
  - C++ host replay が存在する環境では TypeScript golden と比較するテスト
  - **`KIBO_PKG` serial line の CRC/Base64 整合テスト**
- `src/ui/script-runner-view.ts`
  - reset compile 成功後の **runtime IR export（copy / download）**
- `scripts/pico/runtime_vertical_slice/tools/`
  - **`check_pico_baseline.py`**（実機 baseline）
  - **`upload_pico_runtime_package.py`**（`KIBO_PKG` frame 送信 + ack 待ち）
  - **`run_mvp_hardware_acceptance.py`**（baseline + negative + 3 package + trace 比較の一括）
  - **`send_invalid_kibo_pkg_length.py`**（negative gate）
- `runtime/cpp/`
  - C++17 host runtime MVP
  - `every` task / `on button#0.pressed` event の最小 replay
  - 整数式、`var` 初期化、`set`
  - `led#0` と `display#0.clear/circle/present`
  - `kibo_runtime_replay` CLI
  - **`kibo_crc32.hpp` / `kibo_base64_decode.hpp`（Pico 受信検証用）**
- `runtime/pico/vertical_slice/`
  - Pico firmware（PlatformIO / Arduino-Pico）
  - **default `PicoRuntimePackage` を埋め込み**（`include/embedded_default_pico_runtime_package.hpp`）
  - **USB Serial `KIBO_PKG` 1 行 frame で package RAM 差し替え**
  - acceptance 用 trace を USB Serial へ出力
  - OLED 上では live runtime tick
  - 約 3.2 秒ごとに live runtime をリセットして、円が左側から再開する
- `docs/runtime-conformance.md`
  - trace 文法、replay JSON、golden 更新方法
- `docs/bytecode-transfer-design.md`
  - compact binary / bytecode 転送の設計メモ
- `docs/pico-bringup.md`
  - Pico / OLED / button / C++17 / vertical slice の実機確認記録

## 実機確認済み

確認日: 2026-05-04

- Pico は USB Serial `COM11` として認識された。
- `runtime/pico/vertical_slice` は `pio run` でビルド成功。
  - Flash / RAM はツールチェーン・依存ライブラリで変動する。直近では Flash 約 21%、RAM 約 7% 程度。
- `pio run -t upload` は BOOTSEL には入ったが、Windows の `picotool` driver 権限で失敗した。
- 実際の書き込みは `RPI-RP2` ドライブへ `firmware.uf2` をコピーして行った。
- USB Serial で次の trace が取得でき、TypeScript golden と一致した。

```text
trace schema=1 sim_ms=0 led0=0 btn0=0 dpy_fp=b9d103fd6854a325 vars=circle_x=20 sm=-
trace schema=1 sim_ms=100 led0=0 btn0=0 dpy_fp=abb0ec954afd3205 vars=circle_x=24 sm=-
trace schema=1 sim_ms=200 led0=0 btn0=0 dpy_fp=317a917e19c73405 vars=circle_x=28 sm=-
```

## 開発環境メモ

PlatformIO は `uv` で作る `.pico-work/venv` に隔離する。

グローバルの `pio` / `platformio` が見えていても、このリポジトリの手順では使わない。実環境ではユーザー site-packages 側にも PlatformIO が存在していたため、今後の作業では必ず次のように venv 内の実行ファイルを明示する。

```powershell
$repoRoot = (Get-Location).Path
$picoWorkRoot = Join-Path $repoRoot '.pico-work'
$picoVenvPath = Join-Path $picoWorkRoot 'venv'
$picoVenvPython = Join-Path $picoVenvPath 'Scripts\python.exe'

uv venv $picoVenvPath
uv pip install --python $picoVenvPython platformio pyserial

$env:PLATFORMIO_CORE_DIR = Join-Path $picoWorkRoot 'platformio-core'
$env:PLATFORMIO_GLOBALLIB_DIR = Join-Path $picoWorkRoot 'platformio-global-lib'
$env:PLATFORMIO_SETTING_ENABLE_TELEMETRY = 'false'
$pio = Join-Path $picoVenvPath 'Scripts\pio.exe'
```

## まだできないこと

- シミュレーター UI から Pico へ **Web Serial 直送**するインターフェース
- Pico flash への package 永続保存、OTA、暗号署名
- Pico 側の bytecode / compact binary loader（設計は `docs/bytecode-transfer-design.md`）
- USB Serial 以外の転送経路（Wi-Fi 等）
- C++ runtime の full semantics
  - `loop`
  - full `wait`
  - `if`
  - `match`
  - state machine
  - animator
  - single-writer / ownership
  - display text
  - serial input
  - motor / servo / IMU など

## 次にやるべき順序

Simulator to Pico の **MVP（runtime IR export + `PicoRuntimePackage` + `KIBO_PKG` + CLI uploader + 実機 acceptance スクリプト）** は実装済み。詳細手順は [`runtime/pico/vertical_slice/README.md`](../runtime/pico/vertical_slice/README.md) を正とする。

以降は主に次の拡張である。

### 1. C++ host runtime の対応範囲を fixture 単位で広げる

重要度: 高  
難易度: 中〜高  
リスク: 中

- 次に増やす候補:
  - `if_comparison`
  - `wait_milliseconds`
  - `loop`
  - `match_string`
- 追加するたびに TypeScript trace golden と C++ replay 比較を足す。

完了条件:

- 新しい fixture が TypeScript / C++ host の両方で同じ trace を返す。
- C++ 側が未対応 IR を黙って無視しない。

### 2. 任意 script から `PicoRuntimePackage` を生成する（MVP 3 fixture 以外）

重要度: 中  
難易度: 中  
リスク: 中

- UI または CLI で、compile 結果から `replay.steps` と `scriptVarNamesToIncludeInTrace` をどう決めるか（手動指定か、template か）を設計する。
- Pico 未対応 IR のときの診断をユーザー向けに整形する。

### 3. compact binary / bytecode へ移行する

重要度: 中  
難易度: 高  
リスク: 高

- `docs/bytecode-transfer-design.md` を実装へ落とす。
- TypeScript encoder / decoder roundtrip から始める。
- C++ host decoder、Pico decoder の順に進める。

完了条件:

- JSON contract と binary contract の roundtrip が通る。
- Pico が invalid bytecode を拒否できる。

### 4. シミュレーター UI から Pico へ Web Serial で送る（任意）

重要度: 低〜中  
難易度: 高  
リスク: 高（ブラウザ / OS 差）

- 現状は CLI helper が低リスクの正。Web Serial は後追いでよい。

## 注意点

- `runtime/cpp/vendor/nlohmann/json.hpp` は single header として同梱している。Pico の RAM / flash には重いので、長期的には JSON loader を開発用に限定し、bytecode loader へ移す。
- `runtime/pico/vertical_slice/src/kibo_host_runtime_translation_unit.cpp` は共通 C++ runtime を PlatformIO に取り込むための薄い translation unit である。実装の複製ではない。
- IDE の clangd は PlatformIO / Arduino include path を知らないため、`Arduino.h` などで lint error を出すことがある。実際の確認は `pio run` を正とする。
- `picotool` upload は Windows driver 権限で失敗することがある。現状は `RPI-RP2` への UF2 コピーを安定手順とする。
