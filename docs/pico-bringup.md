# Raspberry Pi Pico Bring-Up Notes

## このドキュメントの責務

このドキュメントは、Kibo Script の将来の Raspberry Pi Pico 対応に向けて、実機で確認済みの接続・操作・未確認事項を記録するためのメモである。

## 確認日

2026-05-04

## 対象ボード

- Raspberry Pi Pico
- UF2 bootloader: `UF2 Bootloader v2.0`
- Board ID: `RPI-RP2`
- MicroPython: `v1.28.0`

## ホスト側環境

- Windows
- Pico は MicroPython 書き込み後に USB serial device として `COM10` で認識された。
- `uvx mpremote` で Pico に接続できた。
- C++17 probe（PlatformIO）は `.pico-work/` に隔離して導入した（グローバル Python / グローバル PlatformIO は汚さない）。詳細は次節の `C++17 probe` を参照。

## C++17 probe（PlatformIO / Arduino-Pico harness）

この節は、将来の `runtime/pico` で C++17 を前提にできるかを早めに確認するための **実験用 firmware** の結果である。Kibo Script の本体 runtime ではない。

### 実施日

2026-05-03

### 前提（隔離ビルド）

- 依存はリポジトリ直下の `.pico-work/` に閉じる（`uv` venv と PlatformIO core をここへ向ける）。
- PlatformIO プロジェクト: [`scripts/pico/cpp17_probe/`](../scripts/pico/cpp17_probe/)
- 主要設定（詳細は `platformio.ini`）:
  - `platform = https://github.com/maxgerhardt/platform-raspberrypi.git`
  - `board_build.core = earlephilhower`（ArduinoCore-mbed ではなく Arduino-Pico 系 toolchain を使う）
  - `build_unflags = -std=gnu++11` と `-std=gnu++14` を外し、`build_flags` で `-std=c++17`
- Kibo Script 用の **runtime vertical slice**（host と同じ IR を実機で replay）: [`runtime/pico/vertical_slice/`](../runtime/pico/vertical_slice/README.md)
- ビルド例（リポジトリルートの PowerShell。`venv` と core の実パスは環境に合わせて読み替える）:

```powershell
$repoRoot = (Get-Location).Path
$picoWorkRoot = Join-Path $repoRoot '.pico-work'
$env:PLATFORMIO_CORE_DIR = Join-Path $picoWorkRoot 'platformio-core'
$env:PLATFORMIO_GLOBALLIB_DIR = Join-Path $picoWorkRoot 'platformio-global-lib'
$env:PLATFORMIO_SETTING_ENABLE_TELEMETRY = 'false'
$pio = Join-Path $picoWorkRoot 'venv\Scripts\pio.exe'
Push-Location (Join-Path $repoRoot 'scripts\pico\cpp17_probe')
& $pio run
& $pio run -t size
Pop-Location
```

### 書き込み（Windows での実測メモ）

- `pio run -t upload`（`upload_protocol = picotool`）は、Pico が MicroPython 実行中だと **BOOTSEL へ遷移できず失敗**することがある。
- 代替として `RPI-RP2` ボリュームへ `firmware.uf2` をコピーする方法が確実だった。
- 参考: `machine.bootloader()` は **REPL が独占できているとき**は便利だが、別プロセスが COM を掴んでいると失敗することがある（実測）。

### USB Serial の取りこぼし対策（probe 側）

- USB CDC はホストが遅れて attach すると、`setup()` 冒頭の一度きり出力を取りこぼしやすい。
- そのため probe firmware は **`loop()` で summary を再送**する（測定ループ内では出力しない方針は維持）。
- ホスト側の安定キャプチャ用に [`scripts/pico/cpp17_probe/tools/capture_serial_log.py`](../scripts/pico/cpp17_probe/tools/capture_serial_log.py) を置いた。

```powershell
python scripts\pico\cpp17_probe\tools\capture_serial_log.py --port COM11 --baud 115200 --seconds 25
```

### 実機ログ（代表値: 同一条件で安定再掲されていた）

注: 以下の benchmark 行は過去に取得したログの抜粋である。firmware のソース変更後に同じ数値になる保証はない。

次の行は probe の `kibo_cpp17_probe_summary_repeat` ブロックからそのまま抜粋した（USB Serial / 133MHz / `-Os`）。数値は jitter があり得るため **絶対値より順序関係と桁感**を見る。

- `feature_matrix language=cpp17 stdlib=array,optional,variant,string_view,tuple,function`
- `benchmark array_scan iterations=200000 gross_us=2767042 empty_loop_us=43798 net_us=2723244 ns_per_iteration=13616.220`
- `benchmark bytecode_switch iterations=200000 gross_us=51858 empty_loop_us=0 net_us=51858 ns_per_iteration=259.290`
- `benchmark variant_visit iterations=200000 gross_us=27375 empty_loop_us=0 net_us=27375 ns_per_iteration=136.875`
- `benchmark std_function_dispatch iterations=200000 gross_us=51352 empty_loop_us=0 net_us=51352 ns_per_iteration=256.760`
- `benchmark virtual_dispatch iterations=200000 gross_us=22654 empty_loop_us=0 net_us=22654 ns_per_iteration=113.270`
- `benchmark scheduler_tick iterations=12800000 gross_us=128382 empty_loop_us=0 net_us=128382 ns_per_iteration=10.029`
- `benchmark_sink=1322359231`

### サイズ（`pio run -t size` の `.elf` 行）

- `text=316776`, `data=12032`, `bss=6384`
- PlatformIO のサマリ表示（参考）: Flash 使用量 `61528` bytes、RAM 使用量 `8748` bytes

### 判断メモ（runtime 設計への落とし込み）

- **結論**: Pico 向け Kibo Script runtime は **C++17 で作れる見込みが高い**。host runtime と Pico runtime で共通の C++17 core を持つ方針は現実的。
- **言語機能**: 少なくとも probe で使っている C++17 周り（`constexpr`、fold expression、`if constexpr`（`static_assert` と runtime smoke）、`structured bindings`、CTAD smoke、`<optional>/<variant>/<string_view>/<functional>`、および `tuple` を structured bindings 経由）は **コンパイルと実機 smoke が通った**。
- **採用しやすい部品**: runtime の中核は、固定長バッファ、`std::array`、`std::optional`、`std::variant`、`std::string_view` を中心にするのがよい。
- **hot path の dispatch**: 同条件のログ上では `virtual_dispatch` が `bytecode_switch` より速く見えた。計測対象が完全一致ではないため断定はしないが、**「switch が必ず最速」ではない**（最適化・分岐パターン・命令キャッシュの影響）ことを前提にする。
- **Arduino harness の注意**: 測定は Arduino の `micros()` 前提。将来 `runtime/pico` では **SDK タイマ**へ寄せた再測定が必要。
- **heap を使う標準コンテナ**: `std::vector` / `std::string` は probe では未検証（計画どおり、runtime では別扱い）。使う場合は初期化時だけ、固定上限つき、または allocator 管理ありに制限する。
- **C++20**: `std::span` は C++17 対応確認の対象外（計画どおり）。
- **例外 / RTTI**: probe では有効化していない（組み込み runtime では原則非採用の方向）。

### MicroPython へ復帰（実測）

- MicroPython UF2（この実測では `v1.28.0`）を `RPI-RP2` へコピーして戻した。
- 復帰後、USB Serial は **`COM10`** として再認識された（環境により番号は変わる）。
- 復帰確認: `uvx mpremote connect COM10 run scripts/pico/bringup_check.py` が成功した。

## 再現用スクリプト

今回の bring-up で使った MicroPython の確認処理は [`scripts/pico/bringup_check.py`](../scripts/pico/bringup_check.py) に残している。

```powershell
uvx mpremote connect COM10 run scripts/pico/bringup_check.py
```

このスクリプトは、LED 点滅、I2C scan、OLED 座標系、`present()` 相当の一括反映、描画プリミティブ、ボタン状態表示を順に確認する。将来の Pico runtime 実装ではなく、実機 bring-up の再現用である。

## 確認済みの基本操作

- `RPI-RP2` UF2 bootloader drive として認識できる。
- MicroPython の UF2 firmware をコピーして書き込める。
- BOOTSEL を押さずに USB 再接続しても、MicroPython が `COM10` として復帰する。
- `uvx mpremote connect COM10 exec ...` で MicroPython コードを実行できる。
- onboard LED は `GPIO25` で点滅確認済み。
- MicroPython から `machine.bootloader()` を実行すると、BOOTSEL を押さずに UF2 bootloader mode へ戻せる。

## OLED

SSD1306 互換の 128x64 OLED を I2C で表示確認済み。

| 機能 | Pico 物理ピン | GPIO |
| --- | --- | --- |
| SDA | `PIN21` | `GP16` |
| SCL | `PIN22` | `GP17` |

- I2C address: `0x3C`
- 128x64 framebuffer 表示を確認済み。
- `Kibo Script` / `SSD1306 OK` / `I2C 0x3C` の表示に成功した。
- 座標系はシミュレーターの `display#0` と一致する。左上が `(0, 0)`、右上が `(127, 0)`、左下が `(0, 63)`、右下が `(127, 63)` として表示された。
- `present()` 相当の挙動を確認済み。framebuffer を更新しただけでは画面は変わらず、`show()` 実行時に一括反映された。
- `pixel` / `line` / `circle` 相当の描画プリミティブを目視確認済み。四隅の点、複数方向の線、通常の円、右端で clipping される円が期待通り表示された。

## ボタン

ボタンは内部 pull-up 入力として確認した。押下時の値は `0`、非押下時の値は `1`。

正しい Pico 物理ピン対応は次の通り。

| ボタン表記 | GPIO | 状態 |
| --- | --- | --- |
| `PIN24` | `GP18` | 反応確認済み |
| `PIN25` | `GP19` | 反応確認済み |
| `PIN26` | `GP20` | 反応確認済み |
| `PIN27` | `GP21` | 反応確認済み |
| `PIN29` | `GP22` | 反応確認済み |

周辺の GND は `PIN23` と `PIN28`。

OLED にボタン状態をリアルタイム表示し、`PIN24` / `PIN25` / `PIN26` / `PIN27` / `PIN29` の押下表示が変化することを確認済み。

## 現時点の判断

- `display#0` は、SSD1306 128x64 OLED として実機対応できる見込みが高い。座標系、`present()` 相当の一括反映、基本描画プリミティブもシミュレーターと一致している。
- `button#0` 系は、`GP18` / `GP19` / `GP20` / `GP21` / `GP22` で実機入力を確認済み。
- この段階では Pico 用実装フォルダは作らず、runtime core と host runtime の設計が進んでから `runtime/pico` などを追加する。
