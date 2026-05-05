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

- **Base64 decode 後の JSON 上限**: 32768 bytes（`k_max_decoded_package_bytes`）
- **1 行シリアル上限**: 49152 characters（`k_max_serial_line_characters`）

minified `PicoRuntimePackage` は **常に decode 上限以下**であることをホスト側で preflight する（超過は送信前 reject、80% 接近は bytecode 化の判断材料）。

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
| `radio-state-tuner` | 18426 | 24617 |

ファーム上限（`main.cpp`）: decode 後 **32768** bytes、1 行 **49152** characters。1 行 Base64 で送るため、line 上限は decode 上限より余裕を持たせる。上限超過時は `package_too_large` または `serial_line_too_long` を negative として扱う（`send_oversized_kibo_pkg.py` 参照）。

### 着手条件（bytecode encoder / decoder）

次のいずれかを満たしたら **bytecode のスパイク実装**を優先する。

1. minified JSON が **decode 上限の 80%（26214 bytes）** を超えそう（余裕がなくなる）
2. `nlohmann::json` parse が **ソフトリアルタイム要件**を満たせない（`SOAK-PARSE-001` で計測し閾値超え）
3. flash 永続化で JSON を置くと **セクタ消費が非現実**（[`docs/pico-flash-persistence-gate.md`](pico-flash-persistence-gate.md)）

### JSON 開発フローを続ける期限（現状）

MVP + supported semantics probe 範囲では JSON のまま **Go**（2026-05-05 実機 acceptance 済み。`radio-state-tuner` でも decode 上限の約 56%）。上限接近の監視だけ継続する。

### 実測手順（5 サンプル + parse / upload 時間）

1. `npm test` 内の `pico-runtime-samples.test.ts` または `npm run build-pico-runtime-package` で package を生成する。
2. PowerShell 例: `(Get-Item package.json).Length` で byte 長。
3. 実機: `pico_link_check.py` の前後でホスト時刻を記録し、人間可読ログに残す（詳細は [`docs/pico-final-soak-and-resource-gate.md`](pico-final-soak-and-resource-gate.md)）。
