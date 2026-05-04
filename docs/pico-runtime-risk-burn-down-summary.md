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

## 判定表（2026-05-04 更新）

領域 | 判定 | メモ
--- | --- | ---
Baseline（5 サンプル + 3 golden package + CLI/Web Serial） | **Go** | 再現コマンドと IR 境界を handoff に固定済み。
Semantics（6 probe + 従来 3 fixture） | **Go（TS golden 固定）+ partial C++** | `tests/runtime-conformance/` に trace / replay / IR golden 追加。C++ host は `stateMachines` を拒否（compare テストで skip）。`if` / `wait` / `loop` / `match` は host 側で TS golden と整合する実装済み（ビルドは `npm run build:host-runtime`）。
Loader（`KIBO_PKG` negative） | **Fix first completed** | `send_invalid_kibo_pkg_crc.py` / `send_oversized_kibo_pkg.py`（`package_too_large` または `serial_line_too_long`）/ `send_invalid_kibo_pkg_frame.py` + length sender。`pico_link_common` ユニット拡張。実機ログは bringup テンプレへ。
Simulator→Pico UX | **Fix first completed** | `script-runner-view.ts` で loader / ack / trace mismatch ごとに **install_pico_loader / doctor / upload / pico_link_check（`--repo-root .` + `--trace-var`）** を表示。Playwright fake Web Serial で loader / ack / trace の smoke 追加。
Flash 永続化 | **Redesign decided（実装 Defer）** | [`docs/pico-flash-persistence-gate.md`](pico-flash-persistence-gate.md) に A/B sector + header CRC + fallback 方針と **プロトタイプ開始条件**を明記。実装は bytecode または JSON 上限接近まで保留。
JSON vs bytecode | **Go（現状維持）+ 閾値監視** | [`docs/bytecode-transfer-design.md`](bytecode-transfer-design.md) に 5 サンプルの minified byte 数と `KIBO_PKG` 1 行長を実測追記（decode 上限の約半分以下）。
最終 soak / リソース | **Deferred with explicit gate** | 30 分 ×2 + 100 回 upload の **実機ログはオペレーター責務**。自動環境では未実施を明記し、手順は [`docs/pico-final-soak-and-resource-gate.md`](pico-final-soak-and-resource-gate.md)。Flash/RAM は bringup の `pio run -t size` 行を参照し firmware 更新時に再掲。

## 次に追加する fixture / IR の推奨順

1. ~~`semantics-if-led-branch`（`if`）~~: TS/C++ gate済み（host）。
2. ~~`semantics-wait-skew`（`wait` + `every`）~~: 同上。
3. ~~`semantics-loop-budget`（有限 `loop`）~~: 同上。
4. ~~`semantics-match-string`~~: 同上。
5. `stateMembershipPath` / state machine: **either Pico 実装 or コンパイル時明示拒否**で一本化（現状 C++ / package builder は拒否、TS golden のみ）。

## CI と実機の線引き

- **CI（デフォルト）**: `npm test`（Vitest + `test_pico_link_common.py` の純粋ユニット）、golden JSON、C++ host replay はバイナリがある環境のみ実行（無ければ skip）。
- **実機ジョブ（任意）**: `pico_link_check.py` 1 本、または `run_pico_runtime_samples.py`（USB 必須）、negative sender 群 + bringup テンプレへのログ貼付。

## Exit criteria（「調査完了、追加実装へ進んでよい」）

- baseline matrix が手元環境で再現できる。
- semantics probe の **TS golden が存在**し、C++ が一致するか **unsupported で明示**のどちらかに落ちている。
- loader negative の表に沿って **最低 3 件**（len / crc / oversize / frame のうち実行可能なもの）を実機ログとして残した（テンプレは bringup）。
- UX audit の `UX-FAIL-*` に対し、UI テキストで回復手順が辿れる（E2E smoke 付き）。
- soak gate は **実機長時間が未実施の場合は explicit defer** とし、本番前リリースでは実測必須。
