# 責務: C++ host / Pico で TS golden と一致させる **言語 semantics 最小 probe** の現状（fixture 名・期待 trace・gate 順序）。

親ドキュメント: [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md)  
最終判定: [`docs/pico-runtime-risk-burn-down-summary.md`](pico-runtime-risk-burn-down-summary.md)

## 目的

`if` / `wait` / `loop` / `match` / state machine を足すとき、**TypeScript `SimulationRuntime` の trace を正**として C++ host の差分を先に潰し、Pico 実機は「転送 + 既知 semantics」の上に載せる。2026-05-05 時点で `if` / `wait` / `loop` / `match` の supported probe は Pico 実機 acceptance 済み。

## Gate 順序（必須）

1. **TypeScript**: `executeRuntimeConformanceReplayStepsAndCollectTraceLines` で expected trace を固定（golden）。
2. **C++ host `kibo_runtime_replay`**: 同一 `replay.steps` で trace 一致。
3. **Pico link**: 上記が通った probe だけ `pico_link_check.py` に追加する。

Pico に先に持ち込むと、loader / OLED / timing のノイズで semantics 不具合の切り分けが難しくなる。

## Probe fixture 一覧

以下は `tests/compiler/fixtures/` と `tests/runtime-conformance/` の golden / replay で固定している probe。

| fixture ファイル名 | 状態 | 狙い | 主な IR / 振る舞い | TS trace で固定する観点 |
| --- | --- | --- | --- | --- |
| `semantics-if-led-branch.sc` | supported（TS / C++ / Pico） | `if_comparison` | `every` 内で条件により `led#0.on` / `off` が分岐 | `led0` が期待通り 0/1 遷移 |
| `semantics-wait-skew.sc` | supported（TS / C++ / Pico） | `wait_milliseconds` + `every` 累積 | `every` 本体に `wait` を挟み、次 interval との関係 | `sim_ms` と `led0` / `vars` の順序 |
| `semantics-loop-budget.sc` | supported（TS / C++ / Pico） | `loop` + 協調的停止 | `loop` + `wait` | 初回 loop body が `sim_ms=0` で開始し、`wait` 後に PC が進むこと |
| `semantics-match-string.sc` | supported（TS / C++ / Pico） | `match_string` | 文字列ディスパッチで `assign_var` / device call | `vars` の分岐結果 |
| `semantics-state-membership-every.sc` | unsupported（期待 trace は保持 / C++ compare skip） | state machine × `every` | `stateMembershipPath` が付いた `every` task | supported 化時に `sm=` セグメントが TS と一致 |
| `semantics-state-membership-on-event.sc` | unsupported（期待 trace は保持 / C++ compare skip） | state machine × `on_event` | `stateMembershipPath` が付いた `on_event` | supported 化時にボタン dispatch 後の `sm` と `led0` |

## 各 probe の replay 設計メモ

### `semantics-if-led-branch`

- `replay.steps`: `tick_ms` を粗めに複数回（分岐が評価される tick を含む）。
- `scriptVarNamesToIncludeInTrace`: 空でも可（`led0` だけで判定可能なら最小化）。

### `semantics-wait-skew`

- `wait` 後に `assign_var` でカウンタを増やし、`vars=` に出す。
- C++ 側は `drain_every_task_body` の `resume_at_total_ms` と `tick_milliseconds` の合成がポイント。

### `semantics-loop-budget`

- TS は loop body を `sim_ms=0` で開始する。C++ / Pico も constructor 後に runnable loop を開始して trace を合わせる。
- package builder は loop-only fixture の replay tick を最初の `wait_milliseconds` から推定する。

### `semantics-match-string`

- `temp` / `var` スコープ差分が出やすいので、`vars=` に複数変数を載せる。

### `semantics-state-membership-*`

- 現状 C++ host は `stateMembershipPath` を **明示的に unsupported** としている（MVP）。probe 追加時は **実装 or 拒否ポリシー**のどちらかに振り分ける。

## State machine / animator（現状）

- IR に `stateMachines` / `animatorDefinitions` が含まれる場合、**Pico vertical slice package builder は拒否**し、C++ host compare テストは **明示 skip** する。
- supported へ昇格する場合は、**TS golden を先に固定**し、`compare-typescript-cpp-host-runtime-replay.test.ts` の skip を解除する（[`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md) のバックログ順）。

## 成果物チェックリスト

- [x] supported probe の runtime IR / replay / trace golden
- [x] supported probe の C++ `kibo_runtime_replay` 比較（バイナリがある環境では `npm test` で実行）
- [x] supported probe の Pico 実機 acceptance（`run_pico_semantics_probes.py --port COM11 --repo-root .`）
- [ ] state machine / animator supported 化時の C++ / Pico 実装
