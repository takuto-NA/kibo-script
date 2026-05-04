# 責務: compact binary / bytecode 転送（Pico へ script を差し替える）の設計メモ（未実装）。

## 背景

- 現状の合格ラインは **versioned JSON の runtime IR contract** と **replay steps** による conformance である（`docs/runtime-conformance.md`）。
- firmware rebuild なしに script を差し替える段階では、JSON より **compact binary** が必要になる（帯域・flash・parse コスト）。
- runtime / Pico 対応全体の引き継ぎと次タスクは [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md) を参照する。

## 設計方針（推奨）

### バイナリ形式の骨格

- **magic**: 固定 4 bytes（例: `KIBO`）
- **overall_version**: uint16（互換破壊で増やす）
- **header_crc32**: header 範囲の CRC（実装詳細は後決め）
- **payload_byte_length**: uint32
- **payload_crc32**: payload 全体の CRC
- **string_table**: NUL 終端文字列の連結（offset は uint32 テーブルで参照）
- **typed sections**: tasks / expr / statements / device alias / var metadata を section ID + length + payload で並べる

### セキュリティ / 堅牢性

- **decoder は常に bounds check**（最大長は runtime 側の固定上限と整合）
- **version mismatch** は拒否し、USB Serial に診断行を出す（panic より診断優先）
- **checksum 不一致** は拒否し、再送要求できるプロトコルへ拡張可能にする（初期は拒否のみでよい）

### 転送プロトコル（開発用）

- 最初は **USB Serial のフレーミング**で十分（STX/ETX、または line-based base64）
- 本番寄りに行くなら **chunk + ack** と **resume** を追加する

### encoder / decoder の実装順（推奨）

1. TypeScript: JSON contract → binary（encoder）と binary → JSON（decoder）の **roundtrip テスト**
2. C++ host: decoder のみ（encoder は TS でも可）
3. Pico: decoder のみ（RAM 固定領域へ展開）

## 未決事項（次フェーズで確定させる）

- string / identifier の最大長、task / statement の最大個数
- numeric は int32 固定か、varint か
- display framebuffer は contract に含めない（デバイス側生成物のため）
