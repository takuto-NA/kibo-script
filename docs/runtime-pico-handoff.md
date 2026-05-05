# 責務: Kibo Script runtime / Pico 対応の現在地と次タスクを、次の作業者が迷わないように引き継ぐ。

## 現在地（2026-05-05）

Kibo Script は、TypeScript シミュレーターだけでなく、MVP runtime IR と主要 semantics probe を C++17 host runtime / Pico 実機で同じ trace に揃えるところまで進んでいる（2026-05-05 更新: state machine subset を Pico package / C++ host に載せた）。

現時点で成立している縦断:

```text
Kibo Script fixture / browser.sc
  -> TypeScript compiler
  -> versioned runtime IR contract JSON
  -> PicoRuntimePackage JSON（runtime IR + replay steps + traceObservation + live tick）
  -> TypeScript conformance trace
  -> C++17 host runtime replay
  -> Pico vertical slice firmware（埋め込み default package + USB Serial で RAM 差し替え）
  -> USB Serial trace / OLED display
```

シミュレーター UI からは **runtime IR contract の copy/download**、**`PicoRuntimePackage` の download（trace var 指定 + preflight）**、**Web Serial による `Run simulator & write to Pico`（Chromium 系）**、および **CLI one-shot 手順**まで。権限エラーやヘッドレス検証の **再現に強い正**は [`scripts/pico/runtime_vertical_slice/tools/pico_link_check.py`](../scripts/pico/runtime_vertical_slice/tools/pico_link_check.py) 等の **Python + pyserial**（手順は [`docs/pico-simulator-to-pico-ux-audit.md`](pico-simulator-to-pico-ux-audit.md)）。

## Risk burn-down 成果物（索引）

Burn-down 計画の分割ドキュメント（**plan ファイル本体は編集しない**）。

| 内容 | ドキュメント |
| --- | --- |
| 最終 Go / Fix / Redesign 判定（1 ページ） | [`docs/pico-runtime-risk-burn-down-summary.md`](pico-runtime-risk-burn-down-summary.md) |
| Semantics probe（fixture 名・gate 順） | [`docs/pico-semantics-probe-suite.md`](pico-semantics-probe-suite.md) |
| Loader negative / 上限 | [`docs/pico-loader-protocol-gates.md`](pico-loader-protocol-gates.md) |
| Web Serial / CLI UX | [`docs/pico-simulator-to-pico-ux-audit.md`](pico-simulator-to-pico-ux-audit.md) |
| Flash 永続化 gate | [`docs/pico-flash-persistence-gate.md`](pico-flash-persistence-gate.md) |
| JSON vs bytecode 閾値 | [`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md) |
| 最終 soak（最後の gate） | [`docs/pico-final-soak-and-resource-gate.md`](pico-final-soak-and-resource-gate.md) |

## Risk burn-down: baseline matrix（再現の固定）

### 1) `examples/pico-runtime-samples`（baseline 5 本 + scenario tour 9 本）

#### Baseline（実機 `run_pico_runtime_samples` 連続 upload の主対象）

| sample `name` | ソース | 主な IR 要素（概念） | コミット済み `PicoRuntimePackage` golden |
| --- | --- | --- | --- |
| `led-heartbeat` | `led-heartbeat.sc` | `every` / `led#0.toggle` | `blink-led.pico-runtime-package.json` と同等系 |
| `circle-sweep` | `circle-sweep.sc` | `every` / `const` / `var` / `display#0` / 算術 `+` | `circle-animation.pico-runtime-package.json` と同等系 |
| `two-circle-chase` | `two-circle-chase.sc` | 上記 + `temp` + 複数 `circle` | sample acceptance で生成 package + trace 照合済み |
| `growing-circle` | `growing-circle.sc` | `every` / `var` 半径 + `display#0` | sample acceptance で生成 package + trace 照合済み |
| `button-led-toggle` | `button-led-toggle.sc` | `on_event` `button#0.pressed` / `led#0.toggle` | `button-toggle-on-event.pico-runtime-package.json` と同等系 |

#### Scenario tour（シミュレーター UI の Example 用。`npm test` の `pico-runtime-samples.test.ts` で compile / package / replay を固定）

`examples/pico-runtime-samples/samples.json` にエントリを追加するときは、同テストが **`assessKiboPicoRuntimePackageJsonTextPreflightOrThrow` で `severity` が `reject` または `warn`（decode 上限の 80% 以上）にならないまで merge しない**（閾値と内訳手順は [`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md)）。

| sample `name` | ソース | 主な文法・API（概念） |
| --- | --- | --- |
| `sensor-alert-dashboard` | `sensor-alert-dashboard.sc` | `read adc#0` / `if` / `match` / `display#0.text,circle` |
| `countdown-marquee` | `countdown-marquee.sc` | countdown state / arithmetic / wrap-around branch |
| `button-mode-dashboard` | `button-mode-dashboard.sc` | `on_event` + periodic render / string `match` |
| `rover-scan-sweep` | `rover-scan-sweep.sc` | scan position / `motor#0` / `servo#0` / display |
| `serial-heartbeat-log` | `serial-heartbeat-log.sc` | `serial#0.println`（no-op）+ heartbeat state |
| `waited-status-beacon` | `waited-status-beacon.sc` | `every` body `wait` / phase trace |
| `looped-pulse-train` | `looped-pulse-train.sc` | `task ... loop` / pulse timing |
| `pwm-servo-light-show` | `pwm-servo-light-show.sc` | `pwm#0` / `motor#0` / `servo#0`（no-op）+ mode state |
| `string-command-router` | `string-command-router.sc` | string command routing / display + LED side effects |
| `state-led-pulse` | `state-led-pulse.sc` | `state machine` + `stateMembershipPath` 付き `every`（subset） |
| `radio-state-tuner` | `radio-state-tuner.sc` | 5 `button#` + 2 状態 `state`（global 遷移）+ 単一 `label` 描画（package サイズ優先） |

### 2) 到達パス（どこから package が来るか）

| パス | 実機 USB | 備考 |
| --- | --- | --- |
| A. 埋め込み default package | 不要（起動直後の挙動） | `runtime/pico/vertical_slice/include/embedded_default_pico_runtime_package.hpp` |
| B. `KIBO_PKG` RAM 差し替え | 必須 | UI Web Serial（`script-runner-view.ts`）または `upload_pico_runtime_package.py` / `pico_link_check.py` |
| C. TypeScript のみ | 不要 | golden / `npm test` |

### 3) `KiboHostRuntime`（C++ / Pico 共有）の IR 対応状況

この表は **PicoRuntimePackage に入れて C++ host / Pico vertical slice で動かせるか** の判定であり、TypeScript simulator 全体の対応範囲とは別。compiler / simulator で使える構文でも、ここで未対応なら Pico sample には入れない。

| 項目 | Pico package / runtime 状態 | 使える範囲 | 未対応・注意 |
| --- | --- | --- | --- |
| runtime IR root | 対応 | `runtimeIrContractSchemaVersion == 1`、`compiledProgram` object | schema version 1 以外は throw |
| `var` / `const` initializer | 対応 | int / string literal、対応済み expression | object / array / 未対応 expression は不可 |
| `task ... every` | 対応 | `stateMembershipPath` あり（prefix が IR の state node と一致） | `wait` を含む本体 resume は TS と同順序で評価 |
| `task ... loop` | 対応 | `stateMembershipPath` あり（prefix が IR の state node と一致） | `wait` による協調実行 |
| `task ... on` | 対応 | `device_event` / `state_enter` / `state_exit`（lifecycle は `stateMembershipPath` が exact node path） | `wait` は同期実行パスの acceptance は device path と同様に追跡 |
| `do led#0.*` | 対応 | `toggle()` / `on()` / `off()` | `led#1` 以降や他 method は不可 |
| `do display#0.*` | 対応 | `clear()` / `present()` / `circle(x,y,r)` / `text(x,y,msg)` | `line` / `pixel` などは Pico runtime 未対応 |
| `do serial#0.println(...)` | 部分対応 | 引数 1 個。評価はされる | trace / 実機ログの意味では no-op 扱い |
| `do pwm#0.level(...)` | 部分対応 | 引数 1 個。評価はされる | trace / 実機デバイス効果は no-op 扱い |
| `do motor#0.power(...)` | 部分対応 | 引数 1 個。評価はされる | trace / 実機デバイス効果は no-op 扱い。`motor#1` は不可 |
| `do servo#0.angle(...)` | 部分対応 | 引数 1 個。評価はされる | trace / 実機デバイス効果は no-op 扱い |
| `read adc#0` | 対応 | runtime IR の `adc#0.raw`。既定値は 512 | `adc#1` 以降、他 property、実 ADC 入力の live 反映は未対応 |
| `set` / `temp` | 対応 | int / string var、int temp | string temp は runtime 側の整数評価中心のため Pico sample では避ける |
| `wait` | 部分対応 | `every` / `loop` 本体の直下 | `if` / `match` 分岐内は不可。`on_event` 内 wait は acceptance 未固定 |
| `if` | 対応 | int 比較、string `==` / `!=` | branch 内 `wait` は不可 |
| statement `match` | 対応 | string target、string literal case、必須 `else` | nested `match` や branch 内 `wait` は不可 |
| expression | 対応 | int/string literal、var/const/temp reference、`+ - * /`、単項 `-`、比較、`dt`（every 文脈）、`state_path_elapsed_reference` | string の `< <= > >=`、`step_animator`、`match_numeric_expression`、未対応 expression kind は不可 |
| unit: `ms` | 対応 | `task ... every <N>ms`、`wait <expr> ms`。runtime IR では millisecond integer として扱う | `ms` 以外の時間単位は不可 |
| unit: `%` | 対応 | `50%` のような percent literal。lowering 後は `integer_literal`（例: `50`）として Pico runtime に渡る | 単位情報は runtime IR には残らない。Pico 側で 0-100 の範囲チェックはしない |
| unit: `deg` / `rad` | 未対応 | なし | `deg` は現状 diagnostics 用の不正単位として扱われる箇所が中心。`rad` は構文トークンとして未実装 |

| 未対応項目 | 状態 | 影響 |
| --- | --- | --- |
| `stateMachines` | 対応（subset） | `tickIntervalMilliseconds`、global/local transition（`elapsed` / `command` 等の Pico subset）、composite initial leaf 解決 | 未対応 transition 式は package builder が拒否 |
| `stateMembershipPath` 付き task | 対応（subset） | `task ... in sm.State every/on/loop` の prefix membership | IR 上の path が state node tree と一致しない場合は package builder が拒否 |
| state transition trigger | 対応（subset） | `on sm.State.elapsed >= ... -> ...`、`on command == ... -> ...` 等、validator が許可した式のみ | validator 外の式は拒否 |
| `animatorDefinitions` | 明示的に throw | animator 系 fixture / syntax は Pico sample に入れない |
| 未列挙 device / method | 明示的に throw | display `line` / `pixel`、`motor#1`、`button` method などは不可 |
| 未列挙 `read_property` | 明示的に throw | `adc#0.raw` 以外は不可 |
| 未列挙 statement / expression kind | 明示的に throw | compiler が新しい IR を出しても Pico runtime が黙殺しない方針 |

`unknown` は **コンパイラが新フィールドを出した場合**にホストが黙殺しないよう、テストで検知する（現状は throw 方針）。

**実機 acceptance 済み semantics slice**: `semantics-if-led-branch`、`semantics-wait-skew`、`semantics-loop-budget`、`semantics-match-string` に加え、state subset は `run_pico_semantics_probes.py` が **`semantics-state-membership-every` / `semantics-state-membership-on-event` / `semantics-state-membership-on-event-positive` / `semantics-state-enter-lifecycle`** を順に `pico_link_check.py` で追跡する（C++ `kibo_runtime_replay` との golden 一致前提）。再実行は `run_pico_semantics_probes.py` または `run_mvp_hardware_acceptance.py --profile all` を参照。

### 4) 再現コマンド（コピペ用）

| 目的 | 実機 | コマンド例 |
| --- | --- | --- |
| 単体・golden | 不要 | `npm test` |
| E2E（ブラウザ） | 不要（既定） | `npm run test:e2e` |
| C++ host replay 比較 | 不要 | `npm run build:host-runtime` 後、`KIBO_RUNTIME_REPLAY_EXECUTABLE_PATH=<kibo_runtime_replay のパス> npm test`（バイナリ無しでは skip） |
| Pico ビルド | 不要（ツールチェーンのみ） | `.pico-work/venv` の `pio.exe run`（手順は [`runtime/pico/vertical_slice/README.md`](../runtime/pico/vertical_slice/README.md)） |
| 1 本 upload + trace 照合 | 要 | `python .../pico_link_check.py --port auto --repo-root . --package-file <path>` / `--runtime-ir <path>` / `--source-script <path>`（いずれも `[--trace-var ...] [--tick-ms N] [--replay-preset infer]` 可） |
| `samples.json` 掲載分の連続 upload | 要 | `python scripts/pico/runtime_vertical_slice/tools/run_pico_runtime_samples.py --port auto --repo-root . --capture-seconds 8`（マニフェスト全件。件数増加時は `--capture-seconds` を伸ばす） |
| 一括 acceptance（profile） | 要 | `python .../run_mvp_hardware_acceptance.py --port auto --repo-root . --profile all`（個別に `baseline` / `negative` / `samples` / `semantics` / `ram` / `mvp` も可） |
| RAM 容量（v1 upload + heap trace + 境界サイズ + 復旧） | 要 | `python scripts/pico/runtime_vertical_slice/tools/run_mvp_hardware_acceptance.py --port COMxx --repo-root . --profile ram`（**複数シリアルがある環境では `--port auto` が長時間になることがある**ため COM 明示を推奨）。単体は [`probe_pico_runtime_package_ram_capacity.py`](../scripts/pico/runtime_vertical_slice/tools/probe_pico_runtime_package_ram_capacity.py)（`--package-file` 複数可、`--padded-template-package-file` + `--padded-target-minified-bytes` で `ramProbePadding` 調整）。**decode 上限の実験探索**は [`probe_pico_runtime_package_ram_limit_search.py`](../scripts/pico/runtime_vertical_slice/tools/probe_pico_runtime_package_ram_limit_search.py) または `run_mvp_hardware_acceptance.py --profile ram-limit-search`（各候補で `pio run` + BOOTSEL UF2 + gate。production 12288 は変えない） |
| semantics probes のみ | 要 | `python .../run_pico_semantics_probes.py --port auto --repo-root .` |
| loader 診断 | 要 | `python scripts/pico/runtime_vertical_slice/tools/pico_link_doctor.py --port auto` |
| negative（`KIBO_PKG`） | 要 | 詳細は [`docs/pico-loader-protocol-gates.md`](pico-loader-protocol-gates.md)。例: `send_invalid_kibo_pkg_length.py` / `send_invalid_kibo_pkg_crc.py` / `send_oversized_kibo_pkg.py` / `send_invalid_kibo_pkg_frame.py`（すべて `--port auto` 可） |

### 5) コミット済み golden package サイズ（UTF-8 ファイル byte 数の目安）

計測日: 2026-05-05（再現: リポジトリ上のファイルをバイト数計測）

| ファイル | bytes |
| --- | ---: |
| `tests/runtime-conformance/golden/pico-runtime-packages/blink-led.pico-runtime-package.json` | 1377 |
| `tests/runtime-conformance/golden/pico-runtime-packages/button-toggle-on-event.pico-runtime-package.json` | 1636 |
| `tests/runtime-conformance/golden/pico-runtime-packages/circle-animation.pico-runtime-package.json` | 2812 |

ファーム側 decode 上限 **12288 bytes**（`runtime/cpp/include/kibo_pico_runtime_package_storage_limits.hpp` の既定 macro、実装参照は `main.cpp` / `kibo_device_protocol_v1.hpp`）に対し十分な余裕。肥大化したら [`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md) の閾値へ。

### 5a) RAM 容量計測（`trace schema=1 diag=ram_probe`）

目的: `12288` バイト上限が **通信**ではなく **staging + JSON parse + live runtime** のヒープに効いているかを、フェーズ別の `free_heap` / `used_heap` / `total_heap` とウォーターマーク `min_free_heap` で観測する。

- **ファームウェア**: `runtime/pico/vertical_slice/src/main.cpp` が Earle Philhower `rp2040.getFreeHeap()` 等で上記形式の 1 行 trace を出す（`FILE_BEGIN` 直後、`FILE_COMMIT` 後、`run_package` 経路の parse 前後・dry-run 後・active 代入後・replay 後・live reset 後、および埋め込み default 起動後）。
- **ホスト**: v1 upload 専用の byte preflight（`pico_link_common.evaluate_pico_package_minified_utf8_byte_preflight_for_device_protocol_v1_or_raise`）の **既定**は production **12288** hard reject。実験時のみ `device_protocol_v1_minified_utf8_byte_limit` / CLI `--experiment-max-minified-bytes` でホスト側の境界を macro ビルドと揃える（TS UI の production preflight は探索中は据え置き）。境界サイズは golden をテンプレに未知キー **`ramProbePadding`** を載せて minified バイト数を合わせる（`pico_link_common.build_minified_pico_runtime_package_utf8_bytes_with_ram_probe_padding_target_length_or_raise` / TS `pico-runtime-package-ram-probe-padding.ts`）。
- **実機 gate**: `run_mvp_hardware_acceptance.py --profile ram` が `probe_pico_runtime_package_ram_capacity.py` を呼び出し、`blink-led` と 80% / 90% / `12287` / `12288` を v1 で送る。各成功 upload 後に **golden `blink-led.conformance.trace.txt` と一致する replay trace** を（`diag=ram_probe` 行を除いて）検証し、**全 ram_probe phase** が揃っていることを厳格チェックする。最後に **12289 bytes** をホスト preflight なしで送り `FILE_BEGIN` 側の `file_too_large` 相当で成功 ack にならないことを確認し、続けて **recovery** で `blink-led` が `status=ok` になることを確認する。再現例: `python .../run_mvp_hardware_acceptance.py --port COM11 --repo-root . --profile ram --capture-seconds 15`（`COM11` は環境に合わせて差し替え）。
- **探索 gate（lab）**: `probe_pico_runtime_package_ram_limit_search.py` が候補ごとに `-DKIBO_PICO_RUNTIME_PACKAGE_MAX_MINIFIED_UTF8_BYTES=<N>` でビルドし、BOOTSEL へ UF2 をコピー（Windows）、CDC 復帰待ちのあと `--experiment-max-minified-bytes N` で同一 RAM gate を回す。既定は候補 `14336,16384,...`。**リポジトリ既定の production 12288 を上げる判断**は、本節の表と soak を埋めたうえで [`bytecode-transfer-design.md`](bytecode-transfer-design.md) に結論を書いてから（現時点では **維持** がデフォルト）。

**決定（リポジトリ既定・2026-05-06）**: production の decode 上限は **12288 bytes のまま**。実測上は **24576 bytes が安全候補**（32KiB heap しきい値を大きく上回る）だが、near-limit soak 未実施のため採用コミットではない。採用する場合は C++ macro 既定・`kibo_device_protocol_v1.hpp`・Python/TS preflight・本表を **同じリリース**で更新する。

**実測メモ（2026-05-06）**: COM ポート `COM11`。BOOTSEL は USB 抜き差しなしで 1200bps open/close により `RPI-RP2`（`D:`）へ遷移できた。`picotool` upload は Windows driver 権限で失敗したため、探索候補ごとのファーム差し替えは UF2 copy + CDC handshake で実施した。

| ケース | minified bytes | `commit_after_json_parse.free_heap` | `commit_after_live_runtime_reset.free_heap` | `min_free_heap` | 判定 / メモ |
| --- | ---: | ---: | ---: | ---: | --- |
| blink-led（golden, production gate） | 790 | 203864 | 214072 | 203864 | OK |
| 80% of 12288 | 9830 | 191752 | 195944 | 191752 | OK |
| 90% of 12288 | 11059 | 189304 | 193480 | 189304 | OK |
| 12287 | 12287 | 186840 | 191016 | 186840 | OK |
| 12288 | 12288 | 186840 | 191024 | 186840 | OK / 12289 reject + recovery OK |
| 80% of 16384 | 13107 | 185200 | 189392 | 185200 | OK |
| 90% of 16384 | 14745 | 181928 | 186104 | 181928 | OK |
| 16384 | 16384 | 178648 | 182824 | 178648 | OK |
| 80% of 24576 | 19660 | 172096 | 176288 | 172096 | OK |
| 90% of 24576 | 22118 | 167184 | 171360 | 167184 | OK |
| 24576 | 24576 | 162264 | 166440 | 162264 | OK / 現時点の安全候補 |
| 80% of 32768 | 26214 | 158984 | 163176 | 158984 | OK |
| 90% of 32768 | 29491 | - | - | 158472 | NG: `kibo_pkg_ack` なし。`commit_before_json_parse` までは出たが `commit_after_json_parse` が出ず、後続で COM11 が不安定化 |

**判断**

- **24576 bytes** は、現行 firmware / `blink-led` padding probe では `commit_after_json_parse.free_heap` が約 **162KB** 残るため、12288 からの引き上げ候補として妥当。ただし production 採用前に near-limit soak（20-100 回）を必須にする。
- **32768 bytes** はそのまま採用しない。26KB 台は通るが 29.5KB 付近で ack が返らず、境界は **26214-29491 bytes の間**。
- 公式 `samples.json` の **80% warn gate** は、production 上限を採用コミットで変更するまで緩めない（[`pico-runtime-samples.test.ts`](../tests/runtime-conformance/pico-runtime-samples.test.ts)）。

### 6) 2026-05-05: `radio-state-tuner` 転送失敗の原因と教訓

実機 UI から `radio-state-tuner.sc` を `Run simulator & write to Pico` した際、シミュレーター側は成功したが Pico は package を ack せず、Serial に次の診断を出した。

```text
FAIL: Pico write/verify failed.
Pico did not acknowledge the package.
trace schema=1 diag=serial_line_too_long
```

原因は **Pico の Flash 容量不足ではない**。直近の `pio run` では Flash 約 22%、RAM 約 7% で、ファーム自体の容量には余裕がある。問題は現行 loader が `PicoRuntimePackage` を **1 行の `KIBO_PKG` frame** として受ける設計であり、ファーム側に次の入口上限があること。

| 上限 | 値 | 意味 |
| --- | ---: | --- |
| `k_max_decoded_package_bytes` | 12288 bytes | Base64 decode 後の JSON package を一括で保持 / parse する上限 |
| `k_max_serial_line_characters` | 16384 chars | USB Serial から読む 1 行 frame の上限 |

今回の直接原因は、preflight が minified JSON で `KIBO_PKG` 行長を計算していた一方、Web Serial 送信 (`src/ui/script-runner-view.ts`) が pretty JSON（改行・スペース込み）をそのまま Base64 化していたこと。`radio-state-tuner` の minified package は上限内でも、pretty JSON を送ると 1 行が膨らみ `serial_line_too_long` になる。

修正済みの invariant:

- `src/ui/script-runner-view.ts` の `build_kibo_package_serial_line()` は、送信直前に `JSON.parse` → `JSON.stringify` して **minified UTF-8 bytes** を `KIBO_PKG` 化する。
- `tests/runtime-conformance/kibo-pkg-serial-line-encoding.test.ts` は、pretty JSON を渡しても Web Serial frame の Base64 中身が minified JSON になることを固定する。
- `tests/runtime-conformance/pico-runtime-samples.test.ts` は `samples.json` 全件について preflight を実行し、`reject` だけでなく `warn`（decode 上限の 80% 以上）も禁止する。

このトラブルからの判断:

- `.sc` ソースの行数が直接の上限ではない。compile 後の `runtimeIrContract` JSON が支配的に膨らむ。
- `radio-state-tuner` のサイズ内訳では `runtimeIrContract` が約 96% を占めた（再現は `npm run report-pico-package-utf8-breakdown -- --sample radio-state-tuner`）。
- 現状は「JSON file を保存して実行する」機能ではなく、「JSON package を USB Serial 1 行で RAM へ差し替える」開発用 loader である。
- 長い script を本格的に扱うには、単に `12288` を大きくするより、compact binary / bytecode と chunked transfer へ進むのが正攻法。

### 7) 長い script / 対話基盤への推奨ロードマップ（引き継ぎ）

現行 JSON 1 行転送は MVP / bring-up / デバッグ用として残す。人間が読める JSON と `KIBO_PKG` 1 行は診断しやすく、実機 acceptance の足場として価値がある。ただし、長い script を支える最終形ではない。

重要な方針転換: 次の主作業は **bytecode 単体ではなく、Kibo Device Protocol v1 を先に決める**こと。PC を terminal / keyboard 代わりにする、key / button / sensor event を送る、Pico から trace / log / telemetry / state を受ける、file を送る、bytecode を実行する、といった対話は同じ通信基盤に載せる。詳細は [`docs/kibo-device-protocol-roadmap.md`](kibo-device-protocol-roadmap.md)。

推奨順:

1. **短期 guard を維持**  
   UI / CLI / Python / firmware の preflight 境界を同期し、`samples.json` は `ok` のみ許容する。`warn` は bytecode 着手のサインとして扱う。

2. **IR / package の冗長さを測る**  
   `report-pico-package-utf8-breakdown` で `runtimeIrContract` / `replay` / `traceObservation` の支配率を見る。まずは state 数、遷移密度、trace vars、重複 task を削る。

3. **Kibo Device Protocol v1 を定義する**  
   transport（USB Serial / Web Serial / BLE / TCP）と、framing / envelope / payload codec / domain message を分ける。最小 message は `hello` / `capabilities` / `ping` / `log` / `trace` / `error` / `device_event` / `file_begin` / `file_chunk` / `file_commit` / `run_package`。

4. **chunked file transfer を protocol 上に実装する**  
   まず payload は現行 minified `PicoRuntimePackage` JSON でよい。`file_begin` / `file_chunk` / `file_commit` に index、offset、length、CRC、ack / retry を持たせ、1 行 `KIBO_PKG` の line length 制限から抜ける。

5. **StaticCoreStructuredData と payload codec を整理する**  
   JSON / YAML / TOML は人間向け、MessagePack / CBOR は対話 protocol 向け、compact binary / bytecode は実行向けに位置づける。KiboScript の canonical structured data model から各 codec へ落とす。

6. **compact binary / bytecode を execution payload として追加する**  
   JSON key 名を何度も送らず、task / statement / expression / device address / string table を section 化する。TS encoder / decoder の roundtrip、C++ host decoder、Pico decoder の順に進める。

7. **Flash persistence は protocol / chunked / bytecode の後**  
   受信済み package を Flash に保存し、起動時に last-good を読む。壊れていたら embedded default へ戻す。詳細 gate は [`docs/pico-flash-persistence-gate.md`](pico-flash-persistence-gate.md)。

8. **バッファ上限引き上げだけで延命しない**  
   `k_max_decoded_package_bytes` を大きくするだけなら実装は軽いが、RAM 固定バッファと `nlohmann::json` parse worst-case に直撃する。採用する場合は、なぜ bytecode / chunked より先に必要かを計測付きで残す。

通信基盤の詳細は [`docs/kibo-device-protocol-roadmap.md`](kibo-device-protocol-roadmap.md)、execution payload の詳細設計と bytecode 着手条件は [`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md) を正とする。

### 8) MVP 土台判定（baseline 固定の結論）

- **Go**: 上記 5 サンプル + 3 golden package + loader negative + `if` / `wait` / `loop` / `match` semantics probe + **`run_pico_semantics_probes.py` に載せた state subset** + `KIBO_PKG` trace 照合が、CI / 手元手順で固定済み（実機は本ドキュメント末尾の再現コマンド表で `--profile all` または `--profile semantics` を再実行して確認する）。
- **Fix first completed**: loader negative sender、UX エラー文言、preflight、acceptance profile 化まで実装済み。
- **Redesign / later gate**: flash 永続化、bytecode 実装、**animator** と state の未対応構文、実デバイス PWM / motor / servo 出力は別 gate。

## 実装済み

- `src/runtime-conformance/`
  - runtime IR contract JSON の deterministic serializer
  - **`PicoRuntimePackage` の deterministic serializer**（`build-pico-runtime-package.ts`）
  - **runtime IR contract / compiled program からの `PicoRuntimePackage` 生成**（`--tick-ms` / `--replay-preset` / trace vars / loop wait replay 推定）
  - **package preflight**（minified bytes / `KIBO_PKG` 1 行長の warning / reject、ブラウザ対応 wire encoding）
  - **replay steps を `SimulationRuntime` 上で実行し trace 行を収集**（`execute-runtime-conformance-replay-steps-and-collect-trace-lines.ts`）
  - conformance trace 行の生成
  - `display#0` presented framebuffer の FNV-1a 64bit fingerprint
  - replay document JSON の生成
  - bytecode spike（最小 header + payload roundtrip）
- `tests/runtime-conformance/`
  - `blink-led.sc`
  - `button-toggle-on-event.sc`
  - `circle-animation.sc`
  - `semantics-if-led-branch.sc` / `semantics-wait-skew.sc` / `semantics-loop-budget.sc` / `semantics-match-string.sc`
  - `semantics-state-membership-every.sc` / `semantics-state-membership-on-event.sc` / `semantics-state-membership-on-event-positive.sc` / `semantics-state-enter-lifecycle.sc`
  - `device-display-text.sc` / `device-api-pwm-led.sc` / `device-api-motor-servo-led.sc` / `device-api-serial-led.sc` / `device-api-adc-led.sc`
  - runtime IR contract golden
  - **`PicoRuntimePackage` golden（`golden/pico-runtime-packages/`）**
  - TypeScript `SimulationRuntime` trace golden
  - C++ host replay が存在する環境では TypeScript golden と比較するテスト
  - **`runtime-ir-contract` golden から `PicoRuntimePackage` golden への推定変換テスト**（`runtime-ir-contract-to-pico-runtime-package-golden.test.ts`）
- `src/ui/script-runner-view.ts`
  - reset compile 成功後の **runtime IR export（copy / download）**
  - reset compile 成功後の **`PicoRuntimePackage` download**（trace vars、preflight、CLI hint）
  - Web Serial 書き込み時の loader / ack / trace mismatch 復旧導線
- `scripts/pico/runtime_vertical_slice/tools/`
  - **`pico_link_common.py`**（シリアル・trace 比較・Windows 診断の共通化）
  - **`pico_link_doctor.py`**（COM / BOOTSEL / `KIBO_PING` loader handshake）
  - **`install_pico_loader.py`**（Windows: `RPI-RP2` へ UF2 コピー + 復帰後 handshake）
  - **`build_pico_runtime_package_cli.ts`** + npm script `build-pico-runtime-package`（runtime IR JSON → package）
  - **`print_expected_conformance_trace_lines_from_pico_runtime_package_cli.ts`**（期待 trace 行の stdout 出力）
  - **`pico_link_check.py`**（package または runtime IR → upload → trace 照合。実機要）
  - **`check_pico_baseline.py`**（実機 baseline）
  - **`upload_pico_runtime_package.py`**（preflight `KIBO_PING` + `KIBO_PKG` frame 送信 + ack）
  - **`run_mvp_hardware_acceptance.py`**（`--profile mvp|baseline|negative|samples|semantics|ram|all` + stdout summary）
  - **`probe_pico_runtime_package_ram_capacity.py`**（v1 RAM probe 収集 + JSONL / markdown 要約）
  - **`run_pico_semantics_probes.py`**（semantics probe を `pico_link_check` で連続実行）
  - **`send_invalid_kibo_pkg_length.py`** / **`send_invalid_kibo_pkg_crc.py`** / **`send_oversized_kibo_pkg.py`** / **`send_invalid_kibo_pkg_frame.py`**（negative gate + 既定で復旧 upload）
  - **`test_pico_link_common.py`**（純関数ユニット。`npm test` から `unittest discover` で実行）
- `runtime/cpp/`
  - C++17 host runtime MVP + semantics probes
  - `every` / `loop` / `on button#N.pressed` event replay
  - **state machine subset**（`stateMachines` 解析、tick 順序、`stateMembershipPath` gating、`state_path_elapsed_reference`、trace `sm=`）
  - 整数・文字列式、`var` 初期化、`set`、`if_comparison`、`wait_milliseconds`、`match_string`
  - `led#0` と `display#0.clear/circle/present/text`（Adafruit GLCD 5×7 互換、`runtime/shared/kibo-glcdfont-5x7-bytes.json`）
  - `adc#0.raw` read（既定 512）、`serial#0.println` / `pwm#0.level` / `motor#0.power` / `servo#0.angle` no-op 受理
  - `kibo_runtime_replay` CLI
  - **`kibo_crc32.hpp` / `kibo_base64_decode.hpp`（Pico 受信検証用）**
- `runtime/pico/vertical_slice/`
  - Pico firmware（PlatformIO / Arduino-Pico）
  - **default `PicoRuntimePackage` を埋め込み**（`include/embedded_default_pico_runtime_package.hpp`）
  - **USB Serial `KIBO_PING` → `kibo_loader status=ok protocol=1 ...`（host 診断用）**
  - **USB Serial `KIBO_PKG` 1 行 frame で package RAM 差し替え**
  - **USB Serial Kibo Device Protocol v1（chunked `file_*` + `run_package`）**
  - **`diag=ram_probe` ヒープ観測 trace（フェーズ別）**
  - acceptance 用 trace を USB Serial へ出力
  - OLED 上では live runtime tick
  - 約 3.2 秒ごとに live runtime をリセットして、円が左側から再開する
- `docs/runtime-conformance.md`
  - trace 文法、replay JSON、golden 更新方法
- `docs/bytecode-transfer-design.md`
  - compact binary / bytecode 転送の設計メモ
- `docs/pico-bringup.md`
  - Pico / OLED / button / C++17 / vertical slice の実機確認記録

## 自動テスト（実機・ユーザー操作なし）

- **`npm test`**: Vitest（TypeScript）に加え、`python -m unittest discover` で `scripts/pico/runtime_vertical_slice/tools/test_pico_link_common.py` を実行する（`pico_link_common` の純粋ヘルパのみ。`pyserial` 不要）。**ホストに `python` が PATH 上にある必要がある**（Python 3）。Python が無い CI では Vitest のみを実行するなど切り分ける。
- **Pico sample compile/package/replay**: `tests/runtime-conformance/pico-runtime-samples.test.ts` が `examples/pico-runtime-samples/samples.json` の全 `.sc` を compile し、`PicoRuntimePackage` 化して TypeScript replay trace を生成できることを確認する（実機不要）。
- **`npm run test:e2e`**: Playwright。`playwright.config.ts` の `webServer` が Vite を起動するため、別途 `npm run dev` を手動で立てる必要はない（CI では `CI` 環境変数に合わせて `reuseExistingServer` が無効化される）。
- **Simulator UI Pico write**: Web Serial が使えるブラウザでは script runner の `Run simulator & write to Pico` が、現在の script を reset compile して simulator に反映し、同じ compiled program を `KIBO_PKG` で Pico へ送って、Pico trace と TypeScript replay trace の一致まで確認する。Web Serial が無い環境ではボタンを無効化し、CLI に誘導する。
- **実機前提の Python スクリプト**（`check_pico_baseline.py`, `pico_link_check.py`, `run_mvp_hardware_acceptance.py`, `run_pico_runtime_samples.py` 等）はハードウェアが無い環境では実行できないため、`npm test` には含めない。

## 実機確認済み

確認日: 2026-05-05

- Pico は USB Serial `COM11` として認識された。
- `runtime/pico/vertical_slice` は `pio run` でビルド成功。
  - 直近（2026-05-05）: Flash `454636` bytes（約 21.7%）、RAM `18320` bytes（約 7.0%）。
- `pio run -t upload` は BOOTSEL には入ったが、Windows の `picotool` driver 権限で失敗した。
- 実際の書き込みは `RPI-RP2` ドライブへ `firmware.uf2` をコピーして行った。
- `run_mvp_hardware_acceptance.py --port COM11 --repo-root . --profile all` が **status=ok** で完了した。
  - baseline（circle-animation golden trace）
  - loader negative（length / crc / oversized / invalid base64）
  - 3 golden package
  - `examples/pico-runtime-samples` baseline 5 本（`samples.json` の先頭 5 件に相当）
  - semantics probes（`if` / `wait-skew` / `loop-budget` / `match-string`）
- `examples/pico-runtime-samples/` の **baseline 5 サンプル**（LED heartbeat / circle sweep / two-circle chase / growing circle / button event toggle）は、`run_pico_runtime_samples.py --port auto --repo-root . --capture-seconds 8` で順に upload され、各 sample が TypeScript replay trace と Pico serial trace の一致まで確認済み。
- `samples.json` には上記に加え **scenario tour**（センサー alert、button mode、rover scan、serial heartbeat など）を載せており、シミュレーター UI の Example ドロップダウンと同一。TypeScript 側は `pico-runtime-samples.test.ts` がマニフェスト全件を compile / package / replay で固定する。**scenario tour を含む全本の実機連続 upload を再記録する場合は** `run_pico_runtime_samples.py` を十分な `--capture-seconds` で再実行する。
- 実機ボタンは `button#0..#4 = PIN24/25/26/27/29 = GP18/19/20/21/22`。loader firmware は物理押下の edge を live runtime の `button#N.pressed` に dispatch する。シミュレータ UI も同じ 5 ボタンを表示し、`Press` で対応する `button#N.pressed` を dispatch する。`button-led-toggle.sc` は `button#0`（PIN24 / GP18）で LED toggle する。
- シミュレーター UI から `Run simulator & write to Pico` で Pico へ送る流れも動作確認済み。少なくとも `examples/pico-runtime-samples/led-heartbeat.sc` は、シミュレーターで compile / run した内容を `PicoRuntimePackage` 化し、USB Serial `KIBO_PKG` で Pico へ送り、実機側で LED heartbeat と trace 確認までできた。

実機 acceptance summary:

```text
profile=all
port=COM11
repo_root=C:\Users\chobb\Documents\git\kibo-script
status=ok
```

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

## 未実装 / 制限事項

- Pico flash への package 永続保存、OTA、暗号署名（着手手順: [`docs/pico-flash-persistence-implementation-notes.md`](pico-flash-persistence-implementation-notes.md)）
- Pico 側の bytecode / compact binary loader（設計は `docs/bytecode-transfer-design.md`。TS spike: `src/bytecode/kibo-bytecode-spike.ts`）
- USB Serial 以外の転送経路（Wi-Fi 等）
- C++ / Pico runtime の **未対応領域**
  - **`animatorDefinitions`**（package builder / runtime で拒否）
  - **state の未対応 subset**（validator が許可した IR 以外、複合 state の高度なパターン、未対応 transition 式など）
  - `read_property` の **`adc#0.raw` 以外**（IMU 等）
  - `on_event` 同期実行パスでの `wait_milliseconds` の整理（`partial`）
  - **実デバイスへの** PWM / motor / servo / serial の配線出力（IR は受理するが **no-op**、事故防止のため）
  - display text の **UTF-8 多バイト**（C++ / TS 描画は ASCII MVP）
  - single-writer / ownership モデルの完全実装

## 次にやるべき順序

Simulator to Pico の **MVP（runtime IR export + `PicoRuntimePackage` + `KIBO_PKG` + CLI uploader + 実機 acceptance スクリプト）** に加え、**診断・初回 UF2・IR→package・one-shot trace 照合（`pico_link_*` 系）** まで入っている。詳細手順は [`runtime/pico/vertical_slice/README.md`](../runtime/pico/vertical_slice/README.md) を正とする。

以降は主に次の拡張である。semantics foundation と **state machine の MVP subset** は実機・golden で固定済みなので、次は **実デバイス出力**、**animator**、**state の残タスク（グローバル優先度の追加 probe 等）**に進む。

### 1. 実デバイス出力を no-op から supported へ移す

重要度: 高
難易度: 中
リスク: 中

- 推奨順:
  1. `pwm#0.level` を Pico 実 GPIO / PWM 出力へ接続
  2. `serial#0.println` を USB Serial / trace と衝突しない出力設計へ分離
  3. `servo#0.angle`
  4. `motor#0.power`
- 既存 fixture は runtime IR / trace 上の受理確認として残し、実出力を追加するときに acceptance を増やす。
- 事故防止のため、実モーター系は配線・電源条件を docs に固定してから有効化する。

完了条件:

- 1 API ずつ TypeScript fixture / C++ host / Pico build / 実機 smoke / docs が揃う。
- no-op から実出力へ移した範囲が support matrix と一致する。

### 2. `display.text` をユーザー向け機能として仕上げる

重要度: 中
難易度: 低〜中
リスク: 低

- 現状: ASCII GLCD 5×7 の TS / C++ / Pico trace fingerprint は成立。
- 次: sample、UI 表示、docs、必要なら Playwright smoke を追加する。
- UTF-8 多バイト（日本語など）は別設計。現状は ASCII MVP と明記する。

### 3. animator と state の残りを設計単位で広げる

重要度: 高
難易度: 高
リスク: 高

- **現状（2026-05-05）**: `stateMachines` の **subset** は Pico package / C++ host / 一部 probe で TS golden と一致。`animatorDefinitions` は引き続き拒否。
- **残り（例）**:
  1. **animator**（IR / runtime / package 全体）
  2. state の **追加 semantics probe**（例: global vs local transition 優先の専用 fixture）
  3. validator 外の **compiler が出しうる transition 式**の段階的対応

### 4. compact binary / bytecode へ移行する

重要度: 中
難易度: 高
リスク: 高

- `docs/bytecode-transfer-design.md` を実装へ落とす。
- TypeScript spike（`src/bytecode/kibo-bytecode-spike.ts`）は header + payload roundtrip 済み。本実装は JSON preflight warning（decode 上限 80%）に近づいたら始める。
- C++ host decoder、Pico decoder の順に進める。

完了条件:

- JSON contract と binary contract の roundtrip が通る。
- Pico が invalid bytecode を拒否できる。

### 5. Flash persistence

重要度: 中
難易度: 高
リスク: 高

- 現状は defer が正しい。開始条件と A/B sector 手順は [`docs/pico-flash-persistence-implementation-notes.md`](pico-flash-persistence-implementation-notes.md)。
- bytecode または JSON 上限接近後に実装する。

## 注意点

- `runtime/cpp/vendor/nlohmann/json.hpp` は single header として同梱している。Pico の RAM / flash には重いので、長期的には JSON loader を開発用に限定し、bytecode loader へ移す。
- `runtime/pico/vertical_slice/src/kibo_host_runtime_translation_unit.cpp` は共通 C++ runtime を PlatformIO に取り込むための薄い translation unit である。実装の複製ではない。
- IDE の clangd は PlatformIO / Arduino include path を知らないため、`Arduino.h` などで lint error を出すことがある。実際の確認は `pio run` を正とする。
- `picotool` upload は Windows driver 権限で失敗することがある。現状は `RPI-RP2` への UF2 コピーを安定手順とする。
