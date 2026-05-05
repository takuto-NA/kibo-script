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

`runtime/cpp/include/kibo_pico_runtime_package_storage_limits.hpp`（既定 **12288**、実験時は `-DKIBO_PICO_RUNTIME_PACKAGE_MAX_MINIFIED_UTF8_BYTES`）と `runtime/pico/vertical_slice/src/main.cpp`:

- **Base64 decode 後の JSON 上限**: 12288 bytes（既定 macro と `k_max_decoded_package_bytes` が参照する同一値）
- **1 行シリアル上限**: 16384 characters（`k_max_serial_line_characters`）

minified `PicoRuntimePackage` は **常に decode 上限以下**であることをホスト側で preflight する（超過は送信前 reject、80% 接近は bytecode 化の判断材料）。**CI**: [`pico-runtime-samples.test.ts`](../tests/runtime-conformance/pico-runtime-samples.test.ts) が `samples.json` 全件で `assessKiboPicoRuntimePackageJsonTextPreflightOrThrow` を実行し、`severity === "reject"` を禁止し、**`warn`（decode 上限の 80% 以上）も禁止**してマニフェストの headroom を維持する。

**重要な invariant**: preflight と実送信は同じ **minified UTF-8 bytes** を正にする。過去に UI の Web Serial 送信だけ pretty JSON を Base64 化し、preflight は通るのに実機が `trace schema=1 diag=serial_line_too_long` を出す不整合があった。`src/ui/script-runner-view.ts` の `build_kibo_package_serial_line()` と `tests/runtime-conformance/kibo-pkg-serial-line-encoding.test.ts` が、この「送信直前 minify」を固定する。

### 既知の package サイズ（コミット済み golden）

計測は **ファイルの UTF-8 byte 長**（2026-05-05 時点のリポジトリ）。

| artifact | bytes |
| --- | ---: |
| `blink-led.pico-runtime-package.json` | 1377 |
| `button-toggle-on-event.pico-runtime-package.json` | 1636 |
| `circle-animation.pico-runtime-package.json` | 2812 |

### `examples/pico-runtime-samples`（`samples.json` マニフェスト全件）の minified UTF-8 と `KIBO_PKG` 1 行長（再現コマンド付き）

計測日: **2026-05-05**。minified canonical JSON の UTF-8 byte 数と、`KIBO_PKG schema=1 bytes=<n> crc32=<8hex> b64=<payload>` 形式における **1 行の文字数**（改行除く）を preflight で確認した（マニフェスト全件）。

再現（リポジトリルート）:

```bash
npx tsx -e "import { readFileSync } from 'node:fs'; import { join } from 'node:path'; import { compileScript } from './src/compiler/compile-script.ts'; import { buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow } from './src/runtime-conformance/build-pico-runtime-package-from-runtime-ir-contract.ts'; import { assessKiboPicoRuntimePackageJsonTextPreflightOrThrow } from './src/runtime-conformance/kibo-pico-package-preflight.ts'; const root=process.cwd(); const m=JSON.parse(readFileSync(join(root,'examples/pico-runtime-samples','samples.json'),'utf-8')); for (const s of m.samples){ const src=readFileSync(join(root,'examples/pico-runtime-samples',s.sourceFile),'utf-8').replace(/\r\n/g,'\n'); const c=compileScript(src,s.sourceFile); if(!c.ok) throw new Error(s.sourceFile); const pkg=buildPicoRuntimePackageCanonicalJsonTextFromCompiledProgramWithInferenceOrThrow({compiledProgram:c.program,scriptVarNamesToIncludeInTraceOverride:s.traceVars}); const preflight=assessKiboPicoRuntimePackageJsonTextPreflightOrThrow({canonicalPicoRuntimePackageJsonText:pkg}); console.log(s.name+'\t'+preflight.minifiedUtf8ByteCount+'\t'+preflight.kiboPkgSerialLineCharacterCount); }"
```

| sample | minified UTF-8 bytes | `KIBO_PKG` 1 行文字数（概算） |
| --- | ---: | ---: |
| `led-heartbeat` | 797 | 1111 |
| `circle-sweep` | 1669 | 2276 |
| `two-circle-chase` | 2766 | 3736 |
| `growing-circle` | 1687 | 2300 |
| `button-led-toggle` | 960 | 1327 |
| `sensor-alert-dashboard` | 4064 | 5468 |
| `countdown-marquee` | 3092 | 4172 |
| `button-mode-dashboard` | 4325 | 5816 |
| `rover-scan-sweep` | 4435 | 5964 |
| `serial-heartbeat-log` | 3474 | 4680 |
| `waited-status-beacon` | 2997 | 4044 |
| `looped-pulse-train` | 1396 | 1912 |
| `pwm-servo-light-show` | 3492 | 4704 |
| `string-command-router` | 3722 | 5012 |
| `state-led-pulse` | 1625 | 2216 |
| `radio-state-tuner` | 8838 | 11832 |

ファーム上限（`kibo_pico_runtime_package_storage_limits.hpp` / `main.cpp`）: decode 後 **12288** bytes（既定）、1 行 **16384** characters。1 行 Base64 で送ると **decode 上限を超える payload は行長上限を先に超える**ため、ホストが「12288 超え」を送ると実機では `serial_line_too_long` になり得る（`send_oversized_kibo_pkg.py` 参照）。

### トップレベルキー別 UTF-8（原因追求）

minify 後の `PicoRuntimePackage` 全体の UTF-8 byte 長は、**トップレベル各キーの値部分木** `JSON.stringify(root[key])` の byte 長を並べると「どこが支配的か」が一目で分かる（部分木の合計は全体と一致しないが、`runtimeIrContract` が最大かどうかの判断に使える）。

再現（リポジトリルート、例: `radio-state-tuner` のみ）:

```bash
npm run report-pico-package-utf8-breakdown -- --sample radio-state-tuner
```

2026-05-05 時点の出力例（`radio-state-tuner`）:

| top-level key | value subtree UTF-8 bytes | 全体に対する概算比 |
| --- | ---: | ---: |
| `runtimeIrContract` | 8494 | ~96% |
| `replay` | 176 | ~2% |
| `traceObservation` | 51 | ~1% |
| `live` | 32 | 未満 1% |
| `packageSchemaVersion` | 1 | 未満 1% |

実装: [`break-down-minified-pico-runtime-package-utf8-by-top-level-keys.ts`](../src/runtime-conformance/break-down-minified-pico-runtime-package-utf8-by-top-level-keys.ts)、CLI [`report_pico_runtime_package_utf8_breakdown_by_top_level_key_cli.ts`](../scripts/pico/runtime_vertical_slice/tools/report_pico_runtime_package_utf8_breakdown_by_top_level_key_cli.ts)。回帰は [`pico-runtime-package-utf8-breakdown-by-top-level-key.test.ts`](../tests/runtime-conformance/pico-runtime-package-utf8-breakdown-by-top-level-key.test.ts)。

### 長尺転送・容量の決定木（ロードマップ）

**目的**: 「JSON のまま載せる」範囲を超えたとき、**RAM・1 行シリアル長・実装コスト**のバランスで次手を固定する。

前提: bytecode は単独の通信プロトコルではなく、[`docs/kibo-device-protocol-roadmap.md`](kibo-device-protocol-roadmap.md) の Kibo Device Protocol v1 に載る **execution payload codec** として扱う。PC terminal / keyboard 代替、device event、telemetry、file transfer、state query は protocol 側の責務であり、bytecode は「実行形式の冗長性と parse cost」を解く責務に限定する。

1. **まず IR / package を薄くする（短期）**  
   state 数・遷移密度・`traceVars` を抑え、`runtimeIrContract` の subtree を削る（preflight が `warn` / `reject` になる前の最優先）。

2. **Kibo Device Protocol v1 を先に固定する**  
   `hello` / `capabilities` / `ping` / `log` / `trace` / `error` / `device_event` / `file_begin` / `file_chunk` / `file_commit` / `run_package` を最小 message set として、framing、sequence、CRC、ack / retry、codec negotiation を決める。

3. **chunked file transfer で 1 行制限を外す**  
   最初の payload は minified `PicoRuntimePackage` JSON でよい。これにより `k_max_serial_line_characters`（16384）の 1 行制限を protocol 側で解く。ただし JSON の冗長性と parse cost は残る。

4. **compact binary / bytecode を payload codec として追加する**  
   JSON key 名を送らず、task / statement / expression / device address / string table を section 化する。これは minified UTF-8 と `nlohmann::json` parse の両方に効く（下記「着手条件」参照）。

5. **`k_max_decoded_package_bytes`（12288）の引き上げだけ**  
   実装は軽いが **RAM の decode バッファ**と **parse worst-case** に直撃する。bytecode / 分割より先に採用する場合は、**なぜそれが先か**と受信バッファの根拠（計測 gate）をドキュメントに残す（負債化防止）。

6. **受入（三者同値）**  
   TypeScript `assessKiboPicoRuntimePackageJsonTextPreflightOrThrow`、Python `evaluate_pico_package_payload_preflight_or_raise`（`pico_link_common.py`）、Pico `main.cpp` の定数が同じ境界を指すこと。境界の **+1 byte 超過**は TS の合成 JSON と Python の `build_oversized_minified_package_utf8_bytes_from_template_object_or_raise` で機械的に固定する（[`kibo-pico-package-preflight.test.ts`](../tests/runtime-conformance/kibo-pico-package-preflight.test.ts)、[`test_pico_link_common.py`](../scripts/pico/runtime_vertical_slice/tools/test_pico_link_common.py)）。

### Protocol v1 実測チェックリスト（bytecode 着手前の監視）

bytecode を増やす前に、**転送経路と staging の安定性**を数値で押さえる。

| 監視項目 | 取得方法 | メモ |
| --- | --- | --- |
| minified UTF-8 byte 長 | `npm run report-pico-package-utf8-breakdown -- --sample <name>` | `runtimeIrContract` の支配率が異常に高い場合は IR 側の削減を優先 |
| decode 上限に対する比率 | [`tests/runtime-conformance/pico-runtime-samples.test.ts`](../tests/runtime-conformance/pico-runtime-samples.test.ts) の preflight | `warn`（80% 以上）は bytecode 化のサイン |
| v1 chunked upload のレイテンシ | [`scripts/pico/runtime_vertical_slice/tools/upload_pico_runtime_package_via_device_protocol_v1.py`](../scripts/pico/runtime_vertical_slice/tools/upload_pico_runtime_package_via_device_protocol_v1.py) 実行ログで人手記録 | `SOAK-PARSE-001` の前提データとして [`docs/pico-final-soak-and-resource-gate.md`](pico-final-soak-and-resource-gate.md) へ転記 |
| Pico heap（staging / parse / live） | 実機で `diag=ram_probe`（[`probe_pico_runtime_package_ram_capacity.py`](../scripts/pico/runtime_vertical_slice/tools/probe_pico_runtime_package_ram_capacity.py)、`run_mvp_hardware_acceptance.py --profile ram`）。decode 上限の **掃引実験**は [`probe_pico_runtime_package_ram_limit_search.py`](../scripts/pico/runtime_vertical_slice/tools/probe_pico_runtime_package_ram_limit_search.py)（`-DKIBO_PICO_RUNTIME_PACKAGE_MAX_MINIFIED_UTF8_BYTES` + `--experiment-max-minified-bytes`）。記録枠は [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md) の「5a) RAM 容量計測」 | `12288` 引き上げ判断は計測表を埋めてから（TS production preflight は採用コミットまで据え置き） |
| host-only protocol regression | `npm test`（`kibo-device-protocol-v1.test.ts` + Python unittest） | wire format を変更したら golden hex を両言語で同期 |

**2026-05-06 実測メモ**: Pico vertical slice の RAM 探索では、production 12288 bytes は `commit_after_json_parse.free_heap` 約 **187KB**、24576 bytes は約 **162KB** を残して gate 成功。32768 bytes は 80%（26214 bytes）までは成功したが、90%（29491 bytes）で ack なし。したがって JSON 上限を上げるなら **24576 bytes が暫定安全候補**、32768 bytes は未採用。詳細は [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md) の「5a) RAM 容量計測」。

### 着手条件（bytecode encoder / decoder）

次のいずれかを満たしたら **bytecode のスパイク実装**を優先する。

1. minified JSON が **decode 上限の 80%（9830 bytes）** を超えそう（余裕がなくなる）
2. `nlohmann::json` parse が **ソフトリアルタイム要件**を満たせない（`SOAK-PARSE-001` で計測し閾値超え）
3. flash 永続化で JSON を置くと **セクタ消費が非現実**（[`docs/pico-flash-persistence-gate.md`](pico-flash-persistence-gate.md)）

### JSON 開発フローを続ける期限（現状）

MVP + supported semantics probe 範囲では JSON のまま **Go**（2026-05-05 実機 acceptance 済み。5 サンプル実測でも decode 上限の半分以下）。上限接近の監視だけ継続する。

### 実測手順（5 サンプル + parse / upload 時間）

1. `npm test` 内の `pico-runtime-samples.test.ts` または `npm run build-pico-runtime-package` で package を生成する。
2. PowerShell 例: `(Get-Item package.json).Length` で byte 長。
3. 実機: `pico_link_check.py` の前後でホスト時刻を記録し、人間可読ログに残す（詳細は [`docs/pico-final-soak-and-resource-gate.md`](pico-final-soak-and-resource-gate.md)）。
