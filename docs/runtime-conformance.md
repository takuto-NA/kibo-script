# 責務: Kibo Script の **runtime conformance**（TypeScript `SimulationRuntime` / C++ host runtime / Pico firmware）で共有する trace 形式と replay 入力形式を定義する。

## 目的

- 「同じ runtime IR contract」「同じ replay steps」を入力したとき、**同じ `trace ...` 行**が得られることを合格条件とする。
- compiler golden（`tests/compiler/fixture-runner.test.ts`）とは別に、**Pico が読む契約**と **実行時観測**だけを固定する。
- runtime / Pico 対応全体の現在地と次タスクは [`docs/runtime-pico-handoff.md`](runtime-pico-handoff.md) を参照する。

## 対象 fixture（Phase 0）

次の 3 本を正とする（ソースは `tests/compiler/fixtures/`）。

- `blink-led.sc`
- `button-toggle-on-event.sc`
- `circle-animation.sc`

## `trace` 1 行の文法（schema v1）

`collect_trace` のたびに、次の **1 行**を出す（末尾改行）。

形式（フィールド順固定）:

```text
trace schema=1 sim_ms=<int> led0=<0|1> btn0=<0|1> dpy_fp=<16 hex lower> vars=<vars_segment> sm=<state_machines_segment>
```

### フィールド定義

- `schema`: 現状は常に `1`。
- `sim_ms`: 協調シミュレーションの累積ミリ秒（`SimulationRuntime.tick` の合計）。
- `led0`: `led#0` が点灯扱いなら `1`、そうでなければ `0`。
- `btn0`: `button#0` のシミュレーション押下状態が真なら `1`、そうでなければ `0`。
  - 現状の fixture では `dispatch_device_event` は **イベント配信**であり、ボタンの押下シミュレーション状態を自動では変えないため、通常は `0` のままである。
- `dpy_fp`: `display#0` の **presented framebuffer**（128×64、1 pixel = 1 byte の 0/1）に対する **FNV-1a 64bit** の下位 16 hex（lower case）。
  - 実装は TypeScript の `computePresentedFrameFingerprintFnv1a64FromPresentedFrameBytes` と C++ の `compute_fnv1a64_over_presented_frame_bytes` を正とする。
- `vars`: `traceObservation.scriptVarNamesToIncludeInTrace` に指定された **script var** のスナップショット。
  - **辞書順**で並べる。
  - 各要素は `name=value` を `|` で連結する。
  - 対象 var が **未初期化 / 未収集**なら、その var は省略する。
  - 1 つも出せない場合は `vars=-`。
  - `value` が string の場合のエスケープ規則は TypeScript 実装（`build-runtime-conformance-trace-line-text.ts`）を正とする（現 fixture は数値のみ）。
- `sm`: 状態機械の観測行を `machineName=activeLeafPath` を `|` で連結したもの。
  - 現 fixture は状態機械が無いため TypeScript 側は `sm=-` となる。
  - C++ host runtime MVP は状態機械を未実装のため、当面は常に `sm=-` を出す（fixture 範囲では一致する）。

## `replay.json`（replay schema v1）

C++ `kibo_runtime_replay` と将来の Pico acceptance が共有する入力。

トップレベル:

- `replaySchemaVersion`: 現状は常に `1`
- `runtimeIrContract`: `serializeCompiledProgramToRuntimeIrContractJsonText` が出すオブジェクト（`runtimeIrContractSchemaVersion` + `compiledProgram`）
- `traceObservation.scriptVarNamesToIncludeInTrace`: `vars` に載せる script var 名（配列）
- `steps`: 実行ステップの配列

### `steps` の要素

- `{ "kind": "collect_trace" }`
- `{ "kind": "tick_ms", "elapsedMilliseconds": <int> }`
- `{ "kind": "dispatch_device_event", "deviceKind": "<string>", "deviceId": <int>, "eventName": "<string>" }`

### 実行順序の意味（重要）

1. `tick_ms` は **累積時間を先に進めてから**（`totalSimulationMilliseconds += elapsed`）、`SimulationRuntime` と同順で内部処理を進める。
2. `collect_trace` は呼ばれた瞬間の観測値を出す。

### C++ host runtime MVP の限界（意図的な省略）

- `SimulationRuntime.tick` が行う `advanceStateMachines` と `startRunnableLoopTasks` は、現状の C++ 実装では呼ばない。Phase 0 の fixture ではどちらも実質 noop のため trace 一致に影響しない。
- 状態機械の `sm` セグメントは TypeScript が `listStateMachineInspectRows()` を出すのに対し、C++ は当面 `sm=-` 固定である（fixture では一致）。

## golden の更新方法（開発者向け）

意図せず golden を壊さないため、更新は明示フラグのみ。

```powershell
$env:KIBO_WRITE_RUNTIME_CONFORMANCE_GOLDENS='1'
npx vitest run tests/runtime-conformance
Remove-Item Env:KIBO_WRITE_RUNTIME_CONFORMANCE_GOLDENS
```

## 関連ファイル

- TypeScript trace 収集: `src/runtime-conformance/collect-runtime-conformance-snapshot-from-simulation-runtime.ts`
- runtime IR contract JSON: `src/runtime-conformance/serialize-compiled-program-to-runtime-ir-contract-json-text.ts`
- golden: `tests/runtime-conformance/golden/`
- replay inputs: `tests/runtime-conformance/replay-inputs/`
