# 責務: C++ host / Pico に持ち込む前に潰すための **言語 semantics 最小 probe** の設計（fixture 名・期待 trace・gate 順序）。

親ドキュメント: [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md)  
最終判定: [`docs/pico-runtime-risk-burn-down-summary.md`](pico-runtime-risk-burn-down-summary.md)

## 目的

`if` / `wait` / `loop` / `match` / state machine を後から足すとき、**TypeScript `SimulationRuntime` の trace を正**として C++ host の差分を先に潰し、Pico 実機は「転送 + 既知 semantics」の上に載せる。

## Gate 順序（必須）

1. **TypeScript**: `executeRuntimeConformanceReplayStepsAndCollectTraceLines` で expected trace を固定（golden）。
2. **C++ host `kibo_runtime_replay`**: 同一 `replay.steps` で trace 一致。
3. **Pico link**: 上記が通った probe だけ `pico_link_check.py` に追加する。

Pico に先に持ち込むと、loader / OLED / timing のノイズで semantics 不具合の切り分けが難しくなる。

## Probe fixture 一覧（最低 5 + state machine）

以下のファイル名は `tests/runtime-conformance/` 配下に置く前提の **予約名**（未実装でも「次に作る対象」を固定する）。

| 予約 fixture ファイル名 | 狙い | 主な IR / 振る舞い | TS trace で固定する観点 |
| --- | --- | --- | --- |
| `semantics-if-led-branch.sc` | `if_comparison` | `every` 内で条件により `led#0.on` / `off` が分岐 | `led0` が期待通り 0/1 遷移 |
| `semantics-wait-skew.sc` | `wait_milliseconds` + `every` 累積 | `every` 本体に `wait` を挟み、次 interval との関係 | `sim_ms` と `led0` / `vars` の順序 |
| `semantics-loop-budget.sc` | `loop` + 協調的停止 | 有限回 `loop` + `wait` またはコンパイラが付ける budget | 無限ループにしないこと、PC が進むこと |
| `semantics-match-string.sc` | `match_string` | 文字列ディスパッチで `assign_var` / device call | `vars` の分岐結果 |
| `semantics-state-membership-every.sc` | state machine × `every` | `stateMembershipPath` が付いた `every` task | `sm=` セグメントが TS と一致 |
| `semantics-state-membership-on-event.sc` | state machine × `on_event` | `stateMembershipPath` が付いた `on_event` | ボタン dispatch 後の `sm` と `led0` |

## 各 probe の replay 設計メモ

### `semantics-if-led-branch`

- `replay.steps`: `tick_ms` を粗めに複数回（分岐が評価される tick を含む）。
- `scriptVarNamesToIncludeInTrace`: 空でも可（`led0` だけで判定可能なら最小化）。

### `semantics-wait-skew`

- `wait` 後に `assign_var` でカウンタを増やし、`vars=` に出す。
- C++ 側は `drain_every_task_body` の `resume_at_total_ms` と `tick_milliseconds` の合成がポイント。

### `semantics-loop-budget`

- **Redesign 判定ポイント**: TS が「協調的 yield」なのか、C++ が同じ停止境界を持てるか。
- probe では **有限回** に限定し、無限ループ用は別フェーズ（コンパイル拒否ポリシー）で扱う。

### `semantics-match-string`

- `temp` / `var` スコープ差分が出やすいので、`vars=` に複数変数を載せる。

### `semantics-state-membership-*`

- 現状 C++ host は `stateMembershipPath` を **明示的に unsupported** としている（MVP）。probe 追加時は **実装 or 拒否ポリシー**のどちらかに振り分ける。

## 成果物チェックリスト

- [ ] 各 probe の `*.runtime-ir-contract.golden.json`（または既存 golden 手順）
- [ ] `*.pico-runtime-package.json`（必要な `traceObservation` を含む）
- [ ] `replay` steps の説明コメント（`docs/runtime-conformance.md` にリンク）
- [ ] C++ `kibo_runtime_replay` による一致ログ（CI またはローカル手順）
