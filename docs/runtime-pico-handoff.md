# 責務: Kibo Script runtime / Pico 対応の現在地と次タスクを、次の作業者が迷わないように引き継ぐ。

## 現在地（2026-05-04）

Kibo Script は、TypeScript シミュレーターだけでなく、最小範囲の runtime IR を C++17 runtime で実行し、Pico 実機で確認できるところまで進んでいる。

現時点で成立している縦断:

```text
Kibo Script fixture
  -> TypeScript compiler
  -> versioned runtime IR contract JSON
  -> TypeScript conformance trace
  -> C++17 host runtime replay
  -> Pico vertical slice firmware
  -> USB Serial trace / OLED display
```

ただし、これはまだ **固定 fixture / 埋め込み IR** の段階であり、シミュレーター UI から任意 script を Pico へ転送する機能はない。

## 実装済み

- `src/runtime-conformance/`
  - runtime IR contract JSON の deterministic serializer
  - conformance trace 行の生成
  - `display#0` presented framebuffer の FNV-1a 64bit fingerprint
  - replay document JSON の生成
- `tests/runtime-conformance/`
  - `blink-led.sc`
  - `button-toggle-on-event.sc`
  - `circle-animation.sc`
  - runtime IR contract golden
  - TypeScript `SimulationRuntime` trace golden
  - C++ host replay が存在する環境では TypeScript golden と比較するテスト
- `runtime/cpp/`
  - C++17 host runtime MVP
  - `every` task / `on button#0.pressed` event の最小 replay
  - 整数式、`var` 初期化、`set`
  - `led#0` と `display#0.clear/circle/present`
  - `kibo_runtime_replay` CLI
- `runtime/pico/vertical_slice/`
  - Pico firmware（PlatformIO / Arduino-Pico）
  - `circle-animation` の runtime IR contract を firmware に埋め込み
  - acceptance 用 trace を USB Serial へ出力
  - OLED 上では同じ IR を live runtime として 100ms ごとに tick し、円が動いて見える
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
  - Flash: 約 20.4%
  - RAM: 約 6.9%
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

- シミュレーター UI から Pico へ直接書き込む / 転送するインターフェース
- firmware rebuild なしで script を差し替える仕組み
- Pico 側の bytecode / compact binary loader
- USB Serial 経由の script / IR / bytecode 転送 protocol
- Pico flash への script 保存、version check、checksum、recovery
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

### 1. シミュレーター UI から runtime IR contract を export する

重要度: 高  
難易度: 中  
リスク: 低

- 現在の editor / compiler flow から `CompiledProgram` を取り出し、`serializeCompiledProgramToRuntimeIrContractJsonText` で JSON を出せるようにする。
- まずは download / copy ボタンでよい。
- この段階では Pico 転送までやらない。

完了条件:

- UI 上で script を compile し、runtime IR contract JSON を保存できる。
- 保存した JSON が `tests/runtime-conformance/replay-inputs/` に近い形式で再利用できる。

### 2. C++ host runtime の対応範囲を fixture 単位で広げる

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

### 3. Pico vertical slice を「埋め込み IR 切り替え」しやすくする

重要度: 中  
難易度: 中  
リスク: 低

- 現在は `circle-animation` 固定。
- `blink-led` / `button-toggle-on-event` / `circle-animation` を compile-time option で選べるようにする。
- `platformio.ini` の `build_flags` などで fixture を選択できると確認しやすい。

完了条件:

- 同じ firmware プロジェクトで複数 fixture を選んでビルドできる。
- USB Serial trace がそれぞれの golden と一致する。

### 4. JSON runtime IR を USB Serial で送る開発用 protocol を作る

重要度: 高  
難易度: 高  
リスク: 高

- 最初は compact binary ではなく JSON のままでよい。
- host 側 helper から Pico へ line-based / framed JSON を送り、Pico が RAM に読み込んで実行する。
- checksum と version check はこの段階でも入れる。
- flash 保存は後回しでよい。

完了条件:

- firmware rebuild なしで `circle-animation` 相当を送って実行できる。
- invalid JSON / schema mismatch を panic せず diagnostic として返せる。

### 5. シミュレーター UI から Pico へ送る

重要度: 高  
難易度: 高  
リスク: 高

- UI から runtime IR contract を生成し、host helper / Web Serial / CLI のどれかで Pico へ送る。
- Windows では Web Serial の UX と権限が不安定になり得るため、最初は CLI helper 経由が低リスク。

完了条件:

- ユーザーが script を編集し、シミュレーターで確認し、同じ script を Pico で実行できる。

### 6. compact binary / bytecode へ移行する

重要度: 中  
難易度: 高  
リスク: 高

- `docs/bytecode-transfer-design.md` を実装へ落とす。
- TypeScript encoder / decoder roundtrip から始める。
- C++ host decoder、Pico decoder の順に進める。

完了条件:

- JSON contract と binary contract の roundtrip が通る。
- Pico が invalid bytecode を拒否できる。

## 注意点

- `runtime/cpp/vendor/nlohmann/json.hpp` は single header として同梱している。Pico の RAM / flash には重いので、長期的には JSON loader を開発用に限定し、bytecode loader へ移す。
- `runtime/pico/vertical_slice/src/kibo_host_runtime_translation_unit.cpp` は共通 C++ runtime を PlatformIO に取り込むための薄い translation unit である。実装の複製ではない。
- IDE の clangd は PlatformIO / Arduino include path を知らないため、`Arduino.h` などで lint error を出すことがある。実際の確認は `pio run` を正とする。
- `picotool` upload は Windows driver 権限で失敗することがある。現状は `RPI-RP2` への UF2 コピーを安定手順とする。
