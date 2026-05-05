# 責務: [`docs/pico-flash-persistence-gate.md`](pico-flash-persistence-gate.md) の方針を、実装チケット単位に分解したメモ（開始条件達成後の作業順）。

## 前提（開始条件）

- JSON minified byte 数が運用閾値に近い、または bytecode loader が実装段階に入ったタイミングで着手する（plan 参照）。
- BOOTSEL / UF2 rescue を壊さないことを最優先とする。

## 実装順（推奨）

1. **linker / memory map**: 専用 flash sector（A/B）を map 上で固定し、`pio run -t size` で overflow しないことを確認する。
2. **ヘッダ CRC**: `magic + version + length + crc32(payload)` を host 側ユニットテストで roundtrip する。
3. **読み取りパス**: 起動時に active slot を読み、壊れていれば embedded default package にフォールバックする。
4. **書き込みパス**: 非 active slot に書き、atomic に active ポインタを切り替える（書き込み中断に耐える順序）。
5. **電源断テスト**: 実機で書き込み途中電源断 → 次起動で必ずローダ可能状態に戻ることをログに残す。

## 関連

- 負のケースと復旧手順: [`docs/pico-loader-protocol-gates.md`](pico-loader-protocol-gates.md)
- JSON 継続限界: [`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md)
