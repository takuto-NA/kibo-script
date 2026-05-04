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

## JSON 継続 / bytecode 着手の判断材料（Risk burn-down Phase 6）

### ファームウェア側の実測上限（コード定数）

`runtime/pico/vertical_slice/src/main.cpp`:

- **Base64 decode 後の JSON 上限**: 12288 bytes（`k_max_decoded_package_bytes`）
- **1 行シリアル上限**: 16384 characters（`k_max_serial_line_characters`）

minified `PicoRuntimePackage` は **常に decode 上限以下**であることをホスト側で検査できるとよい（超過は `Redesign` または bytecode 化）。

### 既知の package サイズ（コミット済み golden）

計測は **ファイルの UTF-8 byte 長**（2026-05-04 時点のリポジトリ）。

| artifact | bytes |
| --- | ---: |
| `blink-led.pico-runtime-package.json` | 1377 |
| `button-toggle-on-event.pico-runtime-package.json` | 1636 |
| `circle-animation.pico-runtime-package.json` | 2812 |

### 着手条件（bytecode encoder / decoder）

次のいずれかを満たしたら **bytecode のスパイク実装**を優先する。

1. minified JSON が **decode 上限の 80%（9830 bytes）** を超えそう（余裕がなくなる）
2. `nlohmann::json` parse が **ソフトリアルタイム要件**を満たせない（`SOAK-PARSE-001` で計測し閾値超え）
3. flash 永続化で JSON を置くと **セクタ消費が非現実**（[`docs/pico-flash-persistence-gate.md`](pico-flash-persistence-gate.md)）

### JSON 開発フローを続ける期限（現状）

MVP 範囲では JSON のまま **Go**。上限接近の監視だけ継続する。

### 実測手順（5 サンプル + parse / upload 時間）

1. `npm test` 内の `pico-runtime-samples.test.ts` または `npm run build-pico-runtime-package` で package を生成する。
2. PowerShell 例: `(Get-Item package.json).Length` で byte 長。
3. 実機: `pico_link_check.py` の前後でホスト時刻を記録し、人間可読ログに残す（詳細は [`docs/pico-final-soak-and-resource-gate.md`](pico-final-soak-and-resource-gate.md)）。
