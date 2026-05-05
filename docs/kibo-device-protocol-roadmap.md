# 責務: KiboScript と PC / Pico / 将来デバイス間の共通通信プロトコルを先に定義し、その上に package upload、terminal、telemetry、file transfer、bytecode を載せるためのロードマップ。

## なぜ先に protocol を決めるか

`KIBO_PKG` 1 行転送は、Pico vertical slice の bring-up 用には有効だった。一方で、長い script、PC を terminal / keyboard 代わりにした対話、Pico からの telemetry、file transfer、flash persistence を扱うには、package upload 専用 frame のまま拡張すると責務が混ざる。

今後の基盤は **transport に依存しない Kibo Device Protocol v1** として定義する。USB Serial / Web Serial / BLE / TCP / file replay は transport、KiboScript 側の意味は protocol envelope と message kind に持たせる。

## レイヤー構造

```text
Transport
  USB Serial / Web Serial / BLE / TCP / recorded file

Framing
  magic / version / frame length / sequence / crc / chunk boundary

Envelope
  message kind / request id / codec / payload length / flags

Payload Codec
  StaticCoreStructuredData canonical model
  JSON / MessagePack / CBOR / compact binary / bytecode

Domain Messages
  hello / capabilities / ping / log / trace / error
  key_event / device_event / query_state / telemetry
  file_begin / file_chunk / file_commit
  run_package / run_bytecode / reset_runtime
```

## StaticCoreStructuredData の位置づけ

KiboScript の内部データは、特定の表現（JSON / MessagePack / YAML / TOML / bytecode）に直接依存させない。先に **StaticCoreStructuredData** のような canonical structured data model を置き、用途ごとに codec を選ぶ。

| 表現 | 主用途 |
| --- | --- |
| JSON | debug、golden、手元調査、既存 conformance |
| YAML / TOML | 人間が編集する config / manifest |
| MessagePack / CBOR | 対話 protocol、telemetry、file metadata |
| compact binary / bytecode | Pico 実行 payload、低 RAM / 低 parse cost |

## v1 の最小 message set

最初の v1 は「全部入り」にしない。以下だけを固定し、現行 `KIBO_PING` / `KIBO_PKG` の後継を作る。

| message | 方向 | 目的 |
| --- | --- | --- |
| `hello` | PC -> device | protocol version と host capability の提示 |
| `capabilities` | device -> PC | 対応 codec、最大 frame、最大 chunk、flash 可否 |
| `ping` / `pong` | 双方向 | 接続確認、latency 計測 |
| `log` | device -> PC | 人間向け診断 |
| `trace` | device -> PC | conformance / runtime trace |
| `error` | 双方向 | machine-readable error code + human message |
| `device_event` | PC -> device | key / button / sensor mock / terminal input |
| `query_state` / `state_snapshot` | PC <-> device | vars、state machine path、display fingerprint |
| `file_begin` | PC -> device | file id、kind、codec、total length、whole CRC |
| `file_chunk` | PC -> device | chunk index、offset、payload、chunk CRC |
| `file_commit` | PC -> device | 全 chunk 検証後に commit |
| `run_package` | PC -> device | 受信済み package / bytecode の実行開始 |

## Kibo Device Protocol v1 wire format（確定仕様）

本節は **v1 のバイト列** を実装者が TS / Python / C++ で同一に生成できる粒度まで固定する。転送は任意の byte stream transport（USB Serial 等）でよい。

### 数値 endian と CRC

- **バイト序**: ヘッダ・エンベロープの複数バイト整数は **little-endian**。
- **CRC32**: `runtime/cpp/include/kibo_crc32.hpp` の `compute_crc32_over_bytes` と同一（IEEE 802.3 / PNG / ZIP、初期値 `0xFFFFFFFF`、最終 XOR）。Python は `zlib.crc32`、TypeScript は [`src/runtime-conformance/kibo-kibo-pkg-wire-encoding.ts`](../src/runtime-conformance/kibo-kibo-pkg-wire-encoding.ts) と一致させる。

### レガシー ASCII との共存（USB Serial）

現行ファームは **改行終端** の `KIBO_PING` と `KIBO_PKG ...` を維持する。バイトストリーム先頭が `K I B O` のとき:

- **offset 4 が `'_'`（0x5F）** → レガシー行の継続（`KIBO_PING` / `KIBO_PKG `）。改行まで行バッファへ蓄積する。
- **offset 4-5 が `0x01 0x00`** → **device protocol v1** のヘッダ先頭 6 バイト（magic + `protocol_version=1` LE）。以降は **バイナリ・フレーム ASM** で長さ単位読み取りに切り替える（改行不要）。

### フレームレイアウト

`frame = frame_header_20 || body || body_crc32_4`

#### frame_header_20（固定 20 バイト）

| offset | size | フィールド | 説明 |
| --- | ---: | --- | --- |
| 0 | 4 | `magic` | ASCII `KIBO`（`0x4B 0x49 0x42 0x4F`） |
| 4 | 2 | `protocol_version` | `u16` LE、現状 **1** のみ正当 |
| 6 | 2 | `reserved` | `u16` LE、送信側は **0** |
| 8 | 4 | `sequence` | `u32` LE、ホスト任意（デバイスは応答でエコーしてよい） |
| 12 | 4 | `body_byte_length` | `u32` LE、`body` のバイト数（**12 + payload_length**） |
| 16 | 4 | `header_crc32` | `u32` LE、**bytes `[0..15]`** の CRC32 |

#### body（可変、`body_byte_length` バイト）

`body = envelope_fixed_12 || payload`

##### envelope_fixed_12（固定 12 バイト）

| offset | size | フィールド | 説明 |
| --- | ---: | --- | --- |
| 0 | 1 | `message_kind` | 下表 |
| 1 | 1 | `codec_id` | **0** = payload は UTF-8 JSON テキスト |
| 2 | 2 | `envelope_flags` | `u16` LE、v1 では **0** |
| 4 | 4 | `request_id` | `u32` LE、ホスト任意 |
| 8 | 4 | `payload_length` | `u32` LE、`payload` のバイト数 |

**整合制約**: `payload_length + 12 == body_byte_length`。違反は **error**（実装は拒否）。

#### body_crc32_4（固定 4 バイト）

- `body_crc32`: `u32` LE、`body` 全体（`envelope || payload`）の CRC32。

### message_kind（v1 最小セット）

| kind | 値 | 方向（典型） | payload JSON（codec_id=0） |
| --- | ---: | --- | --- |
| reserved | 0 | — | 使用禁止 |
| hello | 1 | host→device | `{"hostProtocolVersion":1,"hostName":string}` |
| capabilities | 2 | device→host | `{"deviceProtocolVersion":1,"maxBodyByteLength":n,"maxCommittedFileByteLength":n,"supportsFlashCommit":false}` |
| ping | 3 | 双方向 | `{}` または任意診断フィールド |
| pong | 4 | 双方向 | `{}` |
| log | 5 | device→host | `{"message":string}` |
| trace | 6 | device→host | `{"line":string}`（任意。現状はデバイスは既存 `trace ...` 行も出せる） |
| error | 7 | 双方向 | `{"code":string,"message":string}` |
| file_begin | 8 | host→device | `{"fileId":uint,"kind":"pico_runtime_package_json_minified_utf8","totalByteLength":uint,"wholePayloadCrc32":string}`（CRC は **8 hex lower**） |
| file_chunk | 9 | host→device | `{"fileId":uint,"chunkIndex":uint,"byteOffset":uint,"chunkCrc32":string,"payloadBase64":string}` |
| file_commit | 10 | host→device | `{"fileId":uint}`（chunk 再構成済みバイト列の **whole CRC** と **長さ** を検証し staging へコミット） |
| run_package | 11 | host→device | `{}`（staging の minified UTF-8 を現行 `KIBO_PKG` と同じ検証・dry-run・適用へ渡す） |

### デバイス側上限（vertical slice 初期値）

| 定数 | 値 | 意味 |
| --- | ---: | --- |
| `k_kibo_device_protocol_v1_max_body_byte_length` | 4096 | 単一フレームの `body_byte_length` 上限（`envelope`+`payload`） |
| `k_kibo_device_protocol_v1_max_committed_file_byte_length` | 12288 | `file_commit` 後 staging の上限（現行 `k_max_decoded_package_bytes` と整合） |

capabilities の `maxBodyByteLength` / `maxCommittedFileByteLength` は上記を報告する。

### file transfer（chunked JSON payload）

1. `file_begin`: `totalByteLength` と `wholePayloadCrc32` を保存し、受信バッファを空にする。
2. `file_chunk`: Base64 を decode し `byteOffset` へ書き込む想定で **順序どおり append** 検証（実装は **chunkIndex 連番** と累積長で検証）。各 chunk の raw bytes に対する `chunkCrc32` を検証する。
3. `file_commit`: 累積長が `totalByteLength` と一致し、全体 CRC が一致したら **staging** に確定する。まだランタイムは切り替えない。
4. `run_package`: staging を JSON parse → 現行 loader と同一の必須フィールド検証 / dry-run replay → 成功時に active package を更新する。

### machine-readable 応答（デバイス→ホスト）

デバイスはエラー時も **レガシー `trace schema=1 diag=...` に依存せず**、可能な限り `message_kind=error` の v1 フレームを返す（ホストツールがパースしやすくするため）。レガシー経路は移行期間中も維持する。

### 実装参照（コード）

- TypeScript（host-only encode/decode）: [`src/device-protocol/kibo-device-protocol-v1.ts`](../src/device-protocol/kibo-device-protocol-v1.ts)（`build_json_utf8_payload_utf8_bytes_for_*` で JSON payload を UTF-8 化）
- Python（host-only encode/decode）: [`scripts/pico/runtime_vertical_slice/tools/kibo_device_protocol_v1.py`](../scripts/pico/runtime_vertical_slice/tools/kibo_device_protocol_v1.py)
- C++（共有定数・ビルドユニット）: [`runtime/cpp/include/kibo_device_protocol_v1.hpp`](../runtime/cpp/include/kibo_device_protocol_v1.hpp)、Pico ingress: [`runtime/pico/vertical_slice/src/kibo_device_protocol_v1_serial_ingress.cpp`](../runtime/pico/vertical_slice/src/kibo_device_protocol_v1_serial_ingress.cpp)、統合: [`runtime/pico/vertical_slice/src/main.cpp`](../runtime/pico/vertical_slice/src/main.cpp)
- Python（実機アップロード例）: [`scripts/pico/runtime_vertical_slice/tools/upload_pico_runtime_package_via_device_protocol_v1.py`](../scripts/pico/runtime_vertical_slice/tools/upload_pico_runtime_package_via_device_protocol_v1.py)

## 実装順

1. **protocol spec を文書化する**  
   frame header、envelope schema、message kind、error code、capability negotiation を決める。ここでは payload codec を JSON にしてよい。

2. **host-only roundtrip を作る**  
   TypeScript と Python で frame encode/decode、CRC、chunk reassembly、error case をテストする。実機の前に PC 上で protocol を固める。

3. **Pico の hello / capabilities / ping / log / trace を実装する**  
   既存 `KIBO_PING` と trace 行を v1 message に寄せる。旧 `KIBO_PING` は移行期間だけ互換入口として残す。

4. **chunked file transfer を実装する**  
   まず payload は現行 `PicoRuntimePackage` JSON の minified bytes でよい。ここで 1 行 `KIBO_PKG` の line length 制限から抜ける。

5. **run_package を実装する**  
   reassembled JSON package を RAM に置いて、現行 runtime loader と同じ経路で実行する。これにより「長い JSON をファイルとして送る」道ができる。

6. **MessagePack / CBOR codec を追加する**  
   metadata、telemetry、state snapshot の payload を binary structured data に切り替えられるようにする。

7. **compact binary / bytecode を execution payload として追加する**  
   JSON parse cost と package 冗長性を解く。本命の実行形式は protocol の payload の一種として扱う。

8. **Flash persistence を載せる**  
   `file_commit` 後に last-good を Flash 保存し、起動時に検証して実行する。壊れていたら embedded default に戻す。

## 判断ルール

- **通信問題**（1 行長、再送、resume、複数 payload）は Kibo Device Protocol で解く。
- **表現問題**（JSON が大きい、parse が重い）は StaticCoreStructuredData codec / bytecode で解く。
- **永続化問題**（電源断後に残す、last-good rollback）は flash persistence gate で解く。
- `k_max_decoded_package_bytes` を大きくするだけの延命は、RAM と parse worst-case の計測がある場合だけ採用する。

## 既存ドキュメントとの関係

- [`runtime-pico-handoff.md`](runtime-pico-handoff.md): 現在地と実機引き継ぎ。
- [`bytecode-transfer-design.md`](bytecode-transfer-design.md): protocol 上に載せる compact binary / bytecode の設計。
- [`pico-loader-protocol-gates.md`](pico-loader-protocol-gates.md): 現行 `KIBO_PKG` negative gate。v1 protocol 実装時は後継 gate へ移す。
- [`pico-flash-persistence-gate.md`](pico-flash-persistence-gate.md): `file_commit` 後の保存と rollback。
