# 責務: Pico Runtime Risk Burn-down の **最終判定（Go / Fix first / Redesign）** を 1 ページに集約する。

計画本文（編集禁止の plan ファイル）は参照のみ。実装された成果物は次のドキュメントに分割されている。

| Phase | ドキュメント |
| ---: | --- |
| 1 baseline | [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md) の「Risk burn-down: baseline matrix」 |
| 2 semantics | [`docs/pico-semantics-probe-suite.md`](pico-semantics-probe-suite.md) |
| 3 loader | [`docs/pico-loader-protocol-gates.md`](pico-loader-protocol-gates.md) |
| 4 UX | [`docs/pico-simulator-to-pico-ux-audit.md`](pico-simulator-to-pico-ux-audit.md) |
| 5 flash | [`docs/pico-flash-persistence-gate.md`](pico-flash-persistence-gate.md) |
| 6 bytecode 判断 | [`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md) の「JSON 継続 / bytecode 着手の判断材料」 |
| 7 soak | [`docs/pico-final-soak-and-resource-gate.md`](pico-final-soak-and-resource-gate.md) |

## 判定表（2026-05-05 更新）

領域 | 判定 | メモ
--- | --- | ---
Baseline（5 サンプル + 3 golden package + CLI/Web Serial） | **Go（実機 acceptance 済み）** | `run_mvp_hardware_acceptance.py --port COM11 --repo-root . --profile all` が `status=ok`。再現コマンドと IR 境界は handoff に固定済み。
Semantics（4 legacy probe + state subset） | **Go（TS / C++ host / Pico 実機整合）** | `if` / `wait-skew` / `loop-budget` / `match-string` は TypeScript golden、C++ host、Pico 実機 trace が一致。state machine は **validator 通過の subset** を package / C++ に載せ、`compare-typescript-cpp-host-runtime-replay.test.ts` で TS と C++ を照合（`kibo_runtime_replay` 無しでは skip）。`animatorDefinitions` は拒否のまま。
Loader（`KIBO_PKG` negative） | **Fix first completed（実機 acceptance 済み）** | length / crc / oversized / invalid base64 が実機で通過。oversized は現 framing では `serial_line_too_long` が期待されることがある。`pico_link_common` ユニット拡張済み。
Simulator→Pico UX | **Fix first completed** | `script-runner-view.ts` で loader / ack / trace mismatch ごとに **install_pico_loader / doctor / upload / pico_link_check（`--repo-root .` + `--trace-var`）** を表示。Playwright fake Web Serial で loader / ack / trace の smoke 追加。
Flash 永続化 | **Redesign decided（実装 Defer）** | [`docs/pico-flash-persistence-gate.md`](pico-flash-persistence-gate.md) に A/B sector + header CRC + fallback 方針と **プロトタイプ開始条件**を明記。実装は bytecode または JSON 上限接近まで保留。
JSON vs bytecode | **Go（現状維持）+ 閾値監視** | [`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md) に 5 サンプルの minified byte 数と `KIBO_PKG` 1 行長を実測追記（decode 上限の約半分以下）。
最終 soak / リソース | **Deferred with explicit gate** | `--profile all` acceptance は通過済み。30 分 ×2 + 100 回 upload の長時間 soak は別 gate として残す。Flash/RAM は 2026-05-05 build で Flash 約 21.7%、RAM 約 7.0%。

## Semantics probe の現状

1. ~~`semantics-if-led-branch`（`if`）~~: TS/C++/Pico gate 済み。
2. ~~`semantics-wait-skew`（`wait` + `every`）~~: TS/C++/Pico gate 済み。
3. ~~`semantics-loop-budget`（有限 `loop`）~~: TS/C++/Pico gate 済み。
4. ~~`semantics-match-string`~~: TS/C++/Pico gate 済み。
5. ~~`stateMembershipPath` / state machine（Pico subset）~~: **MVP subset は package / C++ / probe に載った**。残りは animator、未対応 transition 式、追加 probe の設計 gate。

## 次に進むべき実装順

1. 実デバイス出力: `pwm#0.level` → `serial#0.println` → `servo#0.angle` → `motor#0.power`
2. `display.text` のユーザー向け sample / docs / UI smoke
3. animator と state の残タスク（追加 probe / validator 拡張）
4. JSON preflight が 80% warning に近づいたら bytecode 本実装
5. bytecode または JSON 上限接近後に flash persistence

## CI と実機の線引き

- **CI（デフォルト）**: `npm test`（Vitest + `test_pico_link_common.py` の純粋ユニット）、golden JSON、C++ host replay はバイナリがある環境のみ実行（無ければ skip）。
- **実機ジョブ（任意 / release 前推奨）**: `run_mvp_hardware_acceptance.py --profile all`。個別確認は `pico_link_check.py`、`run_pico_runtime_samples.py`、`run_pico_semantics_probes.py`。

## Exit criteria（「調査完了、追加実装へ進んでよい」）

- baseline matrix が手元環境で再現できる（2026-05-05 COM11 で `--profile all` 済み）。
- supported semantics probe は TS / C++ / Pico が一致し、**state は subset で一致**、**animator** は unsupported で明示されている。
- loader negative の表に沿って length / crc / oversize / frame が実機で通る。
- UX audit の `UX-FAIL-*` に対し、UI テキストで回復手順が辿れる（E2E smoke 付き）。
- soak gate は **実機長時間が未実施の場合は explicit defer** とし、本番前リリースでは実測必須。
