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
- PlatformIO や Pico SDK は、この確認では導入していない。

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
