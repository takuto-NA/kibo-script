# 責務: C++ host / Pico で TS golden と一致させる **言語 semantics 最小 probe** の現状（fixture 名・期待 trace・gate 順序）。

親ドキュメント: [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md)  
最終判定: [`docs/pico-runtime-risk-burn-down-summary.md`](pico-runtime-risk-burn-down-summary.md)

## 目的

`if` / `wait` / `loop` / `match` / state machine を足すとき、**TypeScript `SimulationRuntime` の trace を正**として C++ host の差分を先に潰し、Pico 実機は「転送 + 既知 semantics」の上に載せる。2026-05-05 時点で `if` / `wait` / `loop` / `match` の supported probe は Pico 実機 acceptance 済み。state machine は **Pico / C++ が追える subset**（membership / elapsed 遷移 / lifecycle 等）を probe で追加し、表の「状態」列を正として固定する。

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
| `semantics-state-membership-every.sc` | supported（TS / C++ / Pico、subset） | state machine × `every` | `stateMembershipPath` が付いた `every` task | `sm=` セグメントと `vars` |
| `semantics-state-membership-on-event.sc` | supported（TS / C++ / Pico、subset） | state machine × `on_event` | `stateMembershipPath` が付いた `on_event` | ボタン dispatch 後の `sm` と `led0` |
| `semantics-state-membership-on-event-positive.sc` | supported（TS / C++ / Pico、subset） | 遷移後の positive `on_event` | tick 後に `sm.On` へ遷移し dispatch | `sm` / `led0` |
| `semantics-state-enter-lifecycle.sc` | supported（TS / C++ / Pico、subset） | `state_enter` lifecycle | `on enter` で `assign_var` | `vars` の `flag` と `sm=` |

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

- `compare-typescript-cpp-host-runtime-replay.test.ts` で TS golden と C++ stdout を一致させる。
- `stateMembershipPath` は prefix 一致（active leaf が path または descendant）で runnable を判定する。

### `semantics-state-enter-lifecycle`

- 先頭 `onEventTasks` が `state_enter` の場合でも、`inferReplayStepsFromCompiledProgramOrThrow` が state machine tick を replay に選ぶ。

## State machine / animator（現状）

- IR に `animatorDefinitions` が含まれる場合、**Pico vertical slice package builder は拒否**する。
- `stateMachines` は **validator が許可した subset** のみ Pico package に載せる（不正な `stateMembershipPath` や未対応 transition 式は拒否）。

## 成果物チェックリスト

- [x] supported probe の runtime IR / replay / trace golden
- [x] supported probe の C++ `kibo_runtime_replay` 比較（バイナリがある環境では `npm test` で実行）
- [x] supported probe の Pico 実機 acceptance（`run_pico_semantics_probes.py --port COM11 --repo-root .`）
- [x] state machine subset の C++ / Pico 追跡（membership / lifecycle / `sm=` trace）
