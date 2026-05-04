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

シミュレーター UI からは **runtime IR contract の copy/download**、**`PicoRuntimePackage` の download（trace var 指定可）**、**Web Serial による `Run simulator & write to Pico`（Chromium 系）**、および **CLI one-shot 手順**まで。権限エラーやヘッドレス検証の **再現に強い正**は [`scripts/pico/runtime_vertical_slice/tools/pico_link_check.py`](../scripts/pico/runtime_vertical_slice/tools/pico_link_check.py) 等の **Python + pyserial**（手順は [`docs/pico-simulator-to-pico-ux-audit.md`](pico-simulator-to-pico-ux-audit.md)）。

## Risk burn-down 成果物（索引）

Burn-down 計画の分割ドキュメント（**plan ファイル本体は編集しない**）。

| 内容 | ドキュメント |
| --- | --- |
| 最終 Go / Fix / Redesign 判定（1 ページ） | [`docs/pico-runtime-risk-burn-down-summary.md`](pico-runtime-risk-burn-down-summary.md) |
| Semantics probe（fixture 名・gate 順） | [`docs/pico-semantics-probe-suite.md`](pico-semantics-probe-suite.md) |
| Loader negative / 上限 | [`docs/pico-loader-protocol-gates.md`](pico-loader-protocol-gates.md) |
| Web Serial / CLI UX | [`docs/pico-simulator-to-pico-ux-audit.md`](pico-simulator-to-pico-ux-audit.md) |
| Flash 永続化 gate | [`docs/pico-flash-persistence-gate.md`](pico-flash-persistence-gate.md) |
| JSON vs bytecode 閾値 | [`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md) |
| 最終 soak（最後の gate） | [`docs/pico-final-soak-and-resource-gate.md`](pico-final-soak-and-resource-gate.md) |

## Risk burn-down: baseline matrix（再現の固定）

### 1) `examples/pico-runtime-samples`（5 本）と主な IR 要素

| sample `name` | ソース | 主な IR 要素（概念） | コミット済み `PicoRuntimePackage` golden |
| --- | --- | --- | --- |
| `led-heartbeat` | `led-heartbeat.sc` | `every` / `led#0.toggle` | `blink-led.pico-runtime-package.json` と同等系 |
| `circle-sweep` | `circle-sweep.sc` | `every` / `const` / `var` / `display#0` / 算術 `+` | `circle-animation.pico-runtime-package.json` と同等系 |
| `two-circle-chase` | `two-circle-chase.sc` | 上記 + `temp` + 複数 `circle` | golden は未コミット（`pico-runtime-samples.test.ts` で生成検証） |
| `growing-circle` | `growing-circle.sc` | `every` / `var` 半径 + `display#0` | 同上 |
| `button-led-toggle` | `button-led-toggle.sc` | `on_event` `button#0.pressed` / `led#0.toggle` | `button-toggle-on-event.pico-runtime-package.json` と同等系 |

### 2) 到達パス（どこから package が来るか）

| パス | 実機 USB | 備考 |
| --- | --- | --- |
| A. 埋め込み default package | 不要（起動直後の挙動） | `runtime/pico/vertical_slice/include/embedded_default_pico_runtime_package.hpp` |
| B. `KIBO_PKG` RAM 差し替え | 必須 | UI Web Serial（`script-runner-view.ts`）または `upload_pico_runtime_package.py` / `pico_link_check.py` |
| C. TypeScript のみ | 不要 | golden / `npm test` |

### 3) `KiboHostRuntime`（C++ / Pico 共有）の IR 対応（`supported` / `partial` / `unsupported`）

| 分類 | 内容 |
| --- | --- |
| `supported` | `runtimeIrContractSchemaVersion == 1` の root / `compiledProgram` object、`varInitializers` / `constInitializers`、`everyTasks` / `onEventTasks`（`triggerKind == device_event` のみ）、statement: `do_method_call`（`led#0` toggle/on/off、`display#0` clear/circle/present）、`assign_var`、`assign_temp`、expression: `integer_literal`、`var_reference`、`const_reference`、`temp_reference`、`binary_add/sub/mul/div`、`unary_minus`、`dt_interval_ms`（`every` 文脈のみ） |
| `partial` | `every` タスク本体の `wait_milliseconds`（`drain_every_task_body` のみ resume 管理）。`on_event` 同期実行パスでは `wait` を同様に扱う **MVP 外**（要 probe） |
| `unsupported`（明示的に throw） | `stateMembershipPath` 付き task、`onEvent` の `triggerKind != device_event`、上記以外の statement / expression / `do_method_call` 先、`if` / `match` / `loop` など |

`unknown` は **コンパイラが新フィールドを出した場合**にホストが黙殺しないよう、テストで検知する（現状は throw 方針）。

### 4) 再現コマンド（コピペ用）

| 目的 | 実機 | コマンド例 |
| --- | --- | --- |
| 単体・golden | 不要 | `npm test` |
| E2E（ブラウザ） | 不要（既定） | `npm run test:e2e` |
| Pico ビルド | 不要（ツールチェーンのみ） | `.pico-work/venv` の `pio.exe run`（手順は [`runtime/pico/vertical_slice/README.md`](../runtime/pico/vertical_slice/README.md)） |
| 1 本 upload + trace 照合 | 要 | `python scripts/pico/runtime_vertical_slice/tools/pico_link_check.py --port auto --repo-root . --package-file <path>` または `--runtime-ir <path>` |
| 5 サンプル連続 | 要 | `python scripts/pico/runtime_vertical_slice/tools/run_pico_runtime_samples.py --port auto --repo-root . --capture-seconds 8` |
| MVP 一括 acceptance | 要 | `python scripts/pico/runtime_vertical_slice/tools/run_mvp_hardware_acceptance.py --port auto --repo-root .` |
| loader 診断 | 要 | `python scripts/pico/runtime_vertical_slice/tools/pico_link_doctor.py --port auto` |
| negative（`KIBO_PKG`） | 要 | 詳細は [`docs/pico-loader-protocol-gates.md`](pico-loader-protocol-gates.md)。例: `send_invalid_kibo_pkg_length.py` / `send_invalid_kibo_pkg_crc.py` / `send_oversized_kibo_pkg.py` / `send_invalid_kibo_pkg_frame.py`（すべて `--port auto` 可） |

### 5) コミット済み golden package サイズ（UTF-8 ファイル byte 数の目安）

計測日: 2026-05-04（再現: リポジトリ上のファイルをバイト数計測）

| ファイル | bytes |
| --- | ---: |
| `tests/runtime-conformance/golden/pico-runtime-packages/blink-led.pico-runtime-package.json` | 1377 |
| `tests/runtime-conformance/golden/pico-runtime-packages/button-toggle-on-event.pico-runtime-package.json` | 1636 |
| `tests/runtime-conformance/golden/pico-runtime-packages/circle-animation.pico-runtime-package.json` | 2812 |

ファーム側 decode 上限 **12288 bytes**（`main.cpp`）に対し十分な余裕。肥大化したら [`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md) の閾値へ。

### 6) MVP 土台判定（baseline 固定の結論）

- **Go**: 上記 5 サンプル + `KIBO_PKG` + trace 照合 +（Chromium で）Web Serial 書き込みまで成立。baseline は本節で固定。
- **Fix first**: loader negative sender 追加、UX エラー文言の恒常的な復旧手順同梱（summary 参照）。
- **Redesign**: flash 永続化、bytecode、full semantics（`stateMembershipPath` 等）は別 gate。

## 実装済み

- `src/runtime-conformance/`
  - runtime IR contract JSON の deterministic serializer
  - **`PicoRuntimePackage` の deterministic serializer**（`build-pico-runtime-package.ts`）
  - **runtime IR contract からの `PicoRuntimePackage` 推定生成**（`build-pico-runtime-package-from-runtime-ir-contract.ts`）
  - **replay steps を `SimulationRuntime` 上で実行し trace 行を収集**（`execute-runtime-conformance-replay-steps-and-collect-trace-lines.ts`）
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
  - **`runtime-ir-contract` golden から `PicoRuntimePackage` golden への推定変換テスト**（`runtime-ir-contract-to-pico-runtime-package-golden.test.ts`）
- `src/ui/script-runner-view.ts`
  - reset compile 成功後の **runtime IR export（copy / download）**
  - reset compile 成功後の **`PicoRuntimePackage` download**（MVP 推定: `every` / `on_event` と live tick、`circle_x` 既定）
- `scripts/pico/runtime_vertical_slice/tools/`
  - **`pico_link_common.py`**（シリアル・trace 比較・Windows 診断の共通化）
  - **`pico_link_doctor.py`**（COM / BOOTSEL / `KIBO_PING` loader handshake）
  - **`install_pico_loader.py`**（Windows: `RPI-RP2` へ UF2 コピー + 復帰後 handshake）
  - **`build_pico_runtime_package_cli.ts`** + npm script `build-pico-runtime-package`（runtime IR JSON → package）
  - **`print_expected_conformance_trace_lines_from_pico_runtime_package_cli.ts`**（期待 trace 行の stdout 出力）
  - **`pico_link_check.py`**（package または runtime IR → upload → trace 照合。実機要）
  - **`check_pico_baseline.py`**（実機 baseline）
  - **`upload_pico_runtime_package.py`**（preflight `KIBO_PING` + `KIBO_PKG` frame 送信 + ack）
  - **`run_mvp_hardware_acceptance.py`**（baseline + negative + 3 package + trace 比較の一括・実機要）
  - **`send_invalid_kibo_pkg_length.py`** / **`send_invalid_kibo_pkg_crc.py`** / **`send_oversized_kibo_pkg.py`** / **`send_invalid_kibo_pkg_frame.py`**（negative gate + 既定で復旧 upload）
  - **`test_pico_link_common.py`**（純関数ユニット。`npm test` から `unittest discover` で実行）
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
  - **USB Serial `KIBO_PING` → `kibo_loader status=ok protocol=1 ...`（host 診断用）**
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

## 自動テスト（実機・ユーザー操作なし）

- **`npm test`**: Vitest（TypeScript）に加え、`python -m unittest discover` で `scripts/pico/runtime_vertical_slice/tools/test_pico_link_common.py` を実行する（`pico_link_common` の純粋ヘルパのみ。`pyserial` 不要）。**ホストに `python` が PATH 上にある必要がある**（Python 3）。Python が無い CI では Vitest のみを実行するなど切り分ける。
- **Pico sample compile/package/replay**: `tests/runtime-conformance/pico-runtime-samples.test.ts` が `examples/pico-runtime-samples/samples.json` の全 `.sc` を compile し、`PicoRuntimePackage` 化して TypeScript replay trace を生成できることを確認する（実機不要）。
- **`npm run test:e2e`**: Playwright。`playwright.config.ts` の `webServer` が Vite を起動するため、別途 `npm run dev` を手動で立てる必要はない（CI では `CI` 環境変数に合わせて `reuseExistingServer` が無効化される）。
- **Simulator UI Pico write**: Web Serial が使えるブラウザでは script runner の `Run simulator & write to Pico` が、現在の script を reset compile して simulator に反映し、同じ compiled program を `KIBO_PKG` で Pico へ送って、Pico trace と TypeScript replay trace の一致まで確認する。Web Serial が無い環境ではボタンを無効化し、CLI に誘導する。
- **実機前提の Python スクリプト**（`check_pico_baseline.py`, `pico_link_check.py`, `run_mvp_hardware_acceptance.py`, `run_pico_runtime_samples.py` 等）はハードウェアが無い環境では実行できないため、`npm test` には含めない。

## 実機確認済み

確認日: 2026-05-04

- Pico は USB Serial `COM11` として認識された。
- `runtime/pico/vertical_slice` は `pio run` でビルド成功。
  - Flash / RAM はツールチェーン・依存ライブラリで変動する。直近では Flash 約 21%、RAM 約 7% 程度。
- `pio run -t upload` は BOOTSEL には入ったが、Windows の `picotool` driver 権限で失敗した。
- 実際の書き込みは `RPI-RP2` ドライブへ `firmware.uf2` をコピーして行った。
- USB Serial で次の trace が取得でき、TypeScript golden と一致した。
- `examples/pico-runtime-samples/` の 5 サンプル（LED heartbeat / circle sweep / two-circle chase / growing circle / button event toggle）は、`run_pico_runtime_samples.py --port auto --repo-root . --capture-seconds 8` で順に upload され、各 sample が TypeScript replay trace と Pico serial trace の一致まで確認済み。
- 実機ボタンは `button#0..#4 = PIN24/25/26/27/29 = GP18/19/20/21/22`。loader firmware は物理押下の edge を live runtime の `button#N.pressed` に dispatch する。シミュレータ UI も同じ 5 ボタンを表示し、`Press` で対応する `button#N.pressed` を dispatch する。`button-led-toggle.sc` は `button#0`（PIN24 / GP18）で LED toggle する。
- シミュレーター UI から `Run simulator & write to Pico` で Pico へ送る流れも動作確認済み。少なくとも `examples/pico-runtime-samples/led-heartbeat.sc` は、シミュレーターで compile / run した内容を `PicoRuntimePackage` 化し、USB Serial `KIBO_PKG` で Pico へ送り、実機側で LED heartbeat と trace 確認までできた。

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

- Pico flash への package 永続保存、OTA、暗号署名
- Pico 側の bytecode / compact binary loader（設計は `docs/bytecode-transfer-design.md`）
- USB Serial 以外の転送経路（Wi-Fi 等）
- C++ runtime の full semantics
  - `loop`
  - `wait_milliseconds` の **一般**対応（現状は **`every` タスク本体**に限定。`on_event` 同期実行パスは未整理）
  - `if`
  - `match`
  - state machine
  - animator
  - single-writer / ownership
  - display text
  - serial input
  - motor / servo / IMU など

## 次にやるべき順序

Simulator to Pico の **MVP（runtime IR export + `PicoRuntimePackage` + `KIBO_PKG` + CLI uploader + 実機 acceptance スクリプト）** に加え、**診断・初回 UF2・IR→package・one-shot trace 照合（`pico_link_*` 系）** まで入っている。詳細手順は [`runtime/pico/vertical_slice/README.md`](../runtime/pico/vertical_slice/README.md) を正とする。

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

- 現状: simulator export の runtime IR から **MVP 推定**（`every` / 先頭 `on_event` / 既定 tick、`circle_x` 既定）で package 化できる（CLI・UI・golden テストあり）。
- 残り: 一般 script 向けに `replay.steps` / `scriptVarNamesToIncludeInTrace` / tick を **ユーザーが完全制御**できる UI・CLI（preset / 明示編集）へ拡張する。
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

### 4. シミュレーター UI から Pico へ Web Serial で送る

重要度: 中（開発体験の主経路）  
難易度: 高（ブラウザ / OS 差）  
リスク: 中（CLI で常に切り替え可能）

- Chromium 系では `Run simulator & write to Pico` が **MVP 動作済み**。失敗系の手順は [`docs/pico-simulator-to-pico-ux-audit.md`](pico-simulator-to-pico-ux-audit.md)。

## 注意点

- `runtime/cpp/vendor/nlohmann/json.hpp` は single header として同梱している。Pico の RAM / flash には重いので、長期的には JSON loader を開発用に限定し、bytecode loader へ移す。
- `runtime/pico/vertical_slice/src/kibo_host_runtime_translation_unit.cpp` は共通 C++ runtime を PlatformIO に取り込むための薄い translation unit である。実装の複製ではない。
- IDE の clangd は PlatformIO / Arduino include path を知らないため、`Arduino.h` などで lint error を出すことがある。実際の確認は `pio run` を正とする。
- `picotool` upload は Windows driver 権限で失敗することがある。現状は `RPI-RP2` への UF2 コピーを安定手順とする。
