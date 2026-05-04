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

## 判定表（現時点のベストエフォート）

領域 | 判定 | メモ
--- | --- | ---
Baseline（5 サンプル + 3 golden package + CLI/Web Serial） | **Go** | 再現コマンドと IR 境界を handoff に固定済み。
Semantics（`if` / full `wait` / `loop` / `match` / `sm`） | **Redesign 寄り（調査継続）** | C++ は `stateMembershipPath` 等を拒否。probe fixture は設計済みだが未実装 → 実装時に TS↔C++ gate を最優先。
Loader（`KIBO_PKG`） | **Fix first** | 上限（12288 decode / 16384 行長）はコード固定。CRC 改変・巨大化 sender を増やすとより **Go** に近づく。
Simulator→Pico UX | **Fix first** | Web Serial 主経路は動作済み。エラー時の恒常的な CLI/UF2 誘導を足すと **Go**。
Flash 永続化 | **Redesign（未着手）** | アドレスマップ・電源断 recovery 未確定。gate 文書のみ。
JSON vs bytecode | **Go（現状維持）+ 閾値監視** | MVP package は数 KB 台。12288 に近づいたら bytecode 着手（bytecode doc 参照）。
最終 soak / リソース | **Pending（最後の gate）** | 条件は [`docs/pico-final-soak-and-resource-gate.md`](pico-final-soak-and-resource-gate.md)。実測は短時間 gate 完了後。

## 次に追加する fixture / IR の推奨順

1. `semantics-if-led-branch`（`if`）: 分岐 + device call の TS/C++ 差分が最も多い。
2. `semantics-wait-skew`（`wait` + `every`）: 時刻モデルの合流。
3. `semantics-loop-budget`（有限 `loop`）: 停止境界ポリシー確定。
4. `semantics-match-string`
5. `stateMembershipPath` を **either 実装 or コンパイル拒否**で一本化。

## CI と実機の線引き

- **CI（デフォルト）**: `npm test`（Vitest + `test_pico_link_common.py` の純粋ユニット）、golden JSON、可能なら C++ host replay。
- **実機ジョブ（任意）**: `pico_link_check.py` 1 本、または `run_pico_runtime_samples.py`（USB 必須）。

## Exit criteria（「調査完了、追加実装へ進んでよい」）

- baseline matrix が手元環境で再現できる。
- semantics probe の **TS golden が存在**し、C++ が一致するか **unsupported で明示**のどちらかに落ちている。
- loader negative の表に沿って **最低 3 件**（len / crc / oversize のうち実行可能なもの）を実機ログとして残した。
- UX audit の `UX-FAIL-*` に対し、README または UI テキストで回復手順が辿れる。
- soak gate は **計画のみ完了**でもよいが、本番前リリースでは実測必須。
