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
