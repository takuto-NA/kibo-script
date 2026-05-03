# StaticCore Script Simulator Status

## このドキュメントの責務

このドキュメントは、ブラウザ版 StaticCore Script Simulator の現状を短く把握できるように、「できていること」「制限」「次にやること」を整理するためのメモである。

すぐ試すための例は [`CHEATSHEET.md`](CHEATSHEET.md) を参照する。

## 現在の要約

MVP として、ブラウザ UI・仮想デバイス・task runtime・full compiler の縦断ルートは動作している。

- ブラウザで端末、script runner、OLED 風 canvas、**three.js による簡易 3D 物理ビュー**、LED ランプ、**pwm#0 レベル（バー + テキスト）**、`button#0` の Press UI を表示できる。
- `compileScript()` で複数行 script を parse / bind / type check / semantic check し、runtime IR に下げられる。
- `var` / `set`、式（`+` `-` `*` `/` 単項 `-`、比較）、`read`、`wait`（整数式）、`const` / `temp`、`match` 文（文字列）/ `match` 式（数値・範囲）、最小 `if`、`task every` / `task on` / **`task loop`** まで実装済み。
- `task on` は `button#0.pressed` 直書きと `ref button = button#0` 経由の `button.pressed` の両方に対応している。
- Embed API から command / tick / snapshot / display frame / ADC 設定 / script load を呼べる。
- structured diagnostics を JSON 互換形式で返せる。

## 動作確認

現状の主要な回帰確認コマンド:

```text
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --audit-level=moderate
```

直近確認:

- `npm run typecheck`: 成功
- `npm test`: 成功（37 files / 109 tests）
- `npm run build`: 成功
- `npm run test:e2e`: 成功（5 tests）
- Script ergonomics: `const` / `temp`、算術・比較、`match` 式（数値・範囲）、`if`、`task loop`、`wait`（整数式）を追加済み。

## ブラウザ UI

ブラウザ上で次を操作できる。

- Interactive terminal: 1 行 command、task 操作、**`list refs` / `list vars` / `list states`**、登録 `ref` 名による `read` / `do` / `.info`、diagnostics 表示。
- StaticCore Script textarea: 複数行 script を **Reset & run** または **Add to runtime** で `compileSourceAndRegisterSimulationTasks` 経由で runtime に登録。
- `serial#0.println(...)`: task / interactive command の出力を terminal に表示。
- `display#0`: 128x64 の 1bit framebuffer を OLED 風 canvas に描画。右パネルに **three.js** の簡易 3D ビュー（車体 + 床 + 筐体上 LED、`led#0` と同期）を表示。
- `led#0`: on/off をランプで表示。
- `pwm#0`: 0–100% の level をバーと数値で表示（script の `pwm#0.level` と同期）。
- `button#0`: Press ボタンで `button#0.pressed` event を dispatch。
- **物理シミュレータ MVP**: `@dimforge/rapier3d-compat` で固定筐体をシミュレート（初期化失敗時は Noop）。`motor#0` / `motor#1` の `power(-100..100)`、`servo#0` の `angle(-180..180)`、`imu#0` の `roll` / `pitch` / `yaw`（ミリ度）および `accel_*`（ミリ g）を `read` できる。Script runtime は `PhysicsWorld` インターフェースのみに依存し、three/Rapier なしでも動作する。

関連ファイル:

- `src/ui/simulator-view.ts`
- `src/ui/physics-scene-view.ts`
- `src/ui/script-runner-view.ts`
- `src/ui/led-view.ts`
- `src/ui/pwm-view.ts`
- `src/ui/button-view.ts`
- `src/ui/styles.css`

## Interactive Command

端末欄では、主に 1 行単位の確認と task 操作ができる。

```text
list tasks | list refs | list vars | list states
read adc#0 | read <ref名>
adc#0.info | <ref名>.info
do serial#0.println("text")
do display#0.clear()
do display#0.pixel(x, y)
do display#0.line(x0, y0, x1, y1)
do display#0.circle(x, y, radius)
do display#0.present()
do led#0.on() | do led#0.off() | do led#0.toggle() | do <ref名>.toggle()
do pwm#0.level(percent) | do <ref名>.level(n)
pwm#0.info
do motor#0.power(percent)
do motor#1.power(percent)
do servo#0.angle(degrees)
read imu#0.roll | read motor#0.power
motor#0.info
task <name> every <N>ms { do ... }
show task <name>
start task <name> | stop task <name>
drop task <name> | drop ref <name> | drop var <name> | drop state <stateMachineRoot>
```

制限:

- interactive task body は現状 1 行 1 つの `do ...` のみ。
- interactive task body で `var` / `set` / `wait` / `match` / `const` / `temp` / `if` を使うには、今後 body parser を拡張する必要がある。
- これらの構文を使う場合は、現状では script textarea の full compiler 経路を使う。

## 仮想デバイス

実装済みデバイス:

- `adc#0`: raw 値を読める。Embed から値を設定できる。
- `serial#0`: `println` による出力を保持し、ブラウザ terminal に表示できる。
- `display#0`: `clear` / `pixel` / `line` / `circle` / `present` に対応。
- `led#0`: `on` / `off` / `toggle` に対応。
- `pwm#0`: `level(percent)` に対応。0-100% に clamp する。
- `button#0`: UI / embed / test から押下状態を注入できる。
- `motor#0` / `motor#1`: `power(percent)`（-100..100）。`read motor#N` は省略時 `power`。
- `servo#0`: `angle(degrees)`（-180..180）。`read servo#N` は省略時 `angle`。
- `imu#0`: `read imu#0.roll` 等（姿勢は **ミリ度**、加速度は **ミリ g**）。`read imu#0` 省略時は `roll`。

- `display#0` の text 描画 API。
- `serial#0` の高度な line input / stream 処理。
- SSD1306 物理互換の I2C / SPI command、page addressing、GDDRAM layout。

## Full Compiler

入口は `src/compiler/compile-script.ts` の `compileScript(sourceText, fileName)`。

成功時は `src/core/executable-task.ts` の `CompiledProgram`（`everyTasks` / `loopTasks` / `onEventTasks` / **`deviceAliases`** / **`varWriterAssignments`** など）を返し、`SimulationRuntime.replaceCompiledProgram()` が var 初期化と task 登録を行う。増分登録は `compileScriptAgainstRuntimeWorld()` と `tryRegisterCompiledProgramAdditive()` を使う。失敗時は `DiagnosticReport` を返す。

実装済みの主な構文:

- `ref`
- `const`
- `var`
- `task <name> every <N>ms`
- `task <name> loop`
- `task <name> on <device#id>.<event>`
- `task <name> on <ref>.<event>`
- `do <device/ref>.<method>(...)`
- `temp <name> = <expression>`
- `set <var> = <expression>`
- `if <comparison> { ... } else { ... }`
- `wait <integer-expression>ms`（実行時 1 回評価。未評価・非整数・0 以下はその task を停止）
- `read <device#id>` 式
- `match <string-expression> { "literal" => { ... } else => { ... } }`
- `match <numeric-expression> { pattern => expression, else => expression }` 式

式 IR:

- integer literal
- percent literal（v1 では整数パーセントへ下げる）
- string literal
- var reference
- const reference
- temp reference
- binary `+` / `-` / `*` / `/`
- unary `-`
- comparison `==` / `!=` / `<` / `<=` / `>` / `>=`
- numeric / percent range `match` expression
- device read

`match` 最小形の制限:

- string `match` は statement として使う。
- numeric / percent range `match` は expression として使う。
- string statement match の target は string 式のみ。
- pattern は string literal と `else` のみ。
- string statement match の `else` は必須。
- string statement match の branch 内は `do` / `set` / `temp` / `if`。
- `match` 分岐内の `wait` / nested statement `match`、および `if` 分岐内の `wait` は未対応。
- range pattern は expression match で対応済み（`a..b` / `..b` / `a..`、左閉右開）。

## Runtime

`SimulationRuntime` は compiled task を cooperative に進める。

- **`replaceCompiledProgram`** で runtime world をまとめて初期化（task / ref alias / var writer メタデータ / 状態機械）。
- **`tryRegisterCompiledProgramAdditive`** で既存 world に衝突チェック付きで追加（atomic に失敗時は変更なし）。
- **`deviceAliases`** はソースの `ref` 宣言のみ IR に載せる（ambient のみの ref はメタデータに重複登録しない）。

- `every` task は `tick(elapsedMilliseconds)` で時間を進める。
- `loop` task は周期タイマを持たず、`wait` で協調的に時間を渡す（tick ごとに継続実行される）。
- `wait` は `resumeAtTotalMilliseconds` により再開時刻を持つ。
- `loop` / `every` は **同一 tick 内の statement 実行上限**を持ち、超過時はその task を停止する（分岐で `wait` を迂回するケースの保険）。
- `task on` は `dispatchScriptEvent({ deviceAddress, eventName })` で同期的に起動する。
- `match_string` は対象式を評価し、該当 branch だけを実行する。
- `assign_temp` は task-local frame に保存し、task 実行開始時にクリアする。
- `if_comparison` は comparison expression の整数結果（0=false, 非0=true）で branch を実行する。
- `match_numeric_expression` は literal / range pattern を順に評価し、該当 arm の式を返す。
- `match` branch 内の `wait` は型検査で拒否するため、runtime の statement list は実行中に書き換えない。

## Embed API

Unity / WebView など別ホストから使うための `postMessage` API がある。

対応済み message:

```text
simulator.command
simulator.tick
simulator.getSnapshot
simulator.getDisplayFrame
simulator.setAdcValue
simulator.loadScript
```

`simulator.getSnapshot` の `outputs` には、少なくとも次が含まれる。

```text
adc0.raw=...
led0.on=...
pwm0.level=...
button0.pressed=...
motor0.power=...
motor1.power=...
servo0.angle=...
imu0.roll_mdeg=...
imu0.pitch_mdeg=...
imu0.yaw_mdeg=...
```

response は成功時 `ok: true`、失敗時 `ok: false` と structured diagnostics を返す。

## Diagnostics

エラーは JSON 互換の structured diagnostics として返す。

代表例:

- `compiler.empty_script`
- `parse.unsupported_command`
- `parse.unsupported_syntax`
- `parse.unexpected_token`
- `bind.cannot_assign_to_const`
- `name.unknown_reference`
- `name.duplicate_declaration`
- `unit.type_mismatch`
- `type.method_not_found`
- `type.method_arity_mismatch`
- `type.argument_type_mismatch`
- `match.target_requires_string`
- `match.branch_unsupported_statement`
- `semantic.duplicate_task_name`
- `semantic.invalid_task_interval`
- `semantic.loop_task_requires_wait`
- `runtime.world.duplicate_name`
- `runtime.world.var_writer_conflict`
- `runtime.world.drop_blocked_by_tasks`
- `runtime.world.unknown_name`
- `runtime.world.state_drop_requires_machine_root`
- `task.unknown`

例:

```json
{
  "schemaVersion": "1.0.0",
  "diagnostics": [
    {
      "id": "runtime.out_of_range",
      "severity": "error",
      "phase": "runtime",
      "message": "Pixel (999, 0) is outside 128x64."
    }
  ]
}
```

## テスト状況

サーバー不要の自動テストで次を確認している。

- interactive command の parse / evaluate
- runtime と device bus
- virtual devices
- OLED framebuffer / RGBA 変換
- structured diagnostics
- full compiler（lexer / parser / binder / type checker / semantic checker / golden fixtures）
- compiled program 登録
- `var` / `set` / `read` / `wait` / `task on` / `task loop` / `match`
- `const` / `temp` / arithmetic / comparison / numeric range `match` / `if`
- `serial#0.println` の task 出力を terminal に逐次表示
- UI の compile 経路
- embed message

Playwright E2E で次を確認している。

- script runner の default blink script で LED UI が変わる。
- script runner に `task on button#0.pressed` を登録し、画面上の `button#0` Press で LED UI が変わる。

代表的なテスト / fixture:

- `tests/compiler/fixtures/blink-led.sc`
- `tests/compiler/fixtures/circle-animation.sc`
- `tests/compiler/fixtures/serial-read-adc.sc`
- `tests/compiler/fixtures/button-toggle-on-event.sc`
- `tests/compiler/fixtures/match-string-command.sc`
- `tests/integration/compiler-runtime.test.ts`
- `tests/integration/wait-task-runtime.test.ts`
- `tests/integration/task-loop-wait-runtime.test.ts`
- `tests/compiler/wait-and-loop-typecheck.test.ts`
- `tests/integration/task-on-button-runtime.test.ts`
- `tests/integration/match-string-runtime.test.ts`
- `tests/e2e/script-runner-led.spec.ts`
- `tests/e2e/script-runner-button.spec.ts`
- `tests/e2e/script-runner-pwm.spec.ts`
- `tests/e2e/script-runner-fade-toggle.spec.ts`
- `tests/e2e/script-runner-physics.spec.ts`

## `draft.md` との差分と現在の制限

現状は MVP + Phase 1 の一部であり、`draft.md` 全体の実装ではない。

できること:

- `ref` / `var` / `set` / `read` / `wait`（整数式）
- `const` / `temp`
- `task every` / `task on` / `task loop`
- 文字列 `match` の最小形、数値 / percent の `match` 式と range pattern
- 最小 `if` 文（comparison 条件）
- 算術 `+` / `-` / `*` / `/` と単項 `-`
- `led#0` の on / off / toggle
- `pwm#0.level(number)` による PWM 出力値の変更
- **animator**: **`animator ... = ramp from A% to B% over Nms ease linear|ease_in_out`** と **`step <name> with dt`**（固定端点の one-shot ramp）、および **`animator ... = ramp over Nms ease linear|ease_in_out`** と **`step <name> with <target_expr> dt`**（目標値ドリブン。`task on` は目標 `var` の更新のみ、`task every` が `step`）（いずれも `task on` / `task loop` / var 初期化では `dt` / `step` 不可）
- **パーセントリテラル** `0%`…`100%`（v1 では整数パーセントに下ろす）
- `display#0` の基本図形描画（clear / pixel / line / circle / present）

まだできないこと:

- `%` を独立した型としての完全実装（角度や別単位との混合など）
- `filter` / `estimator` / `controller`
- **animator の pause / reverse、`do animator.start()` 等のメソッド**
- nested `match`
- `wait until`、`else return`
- `draft.md` 相当の **IMU ベクトル型**（`read imu#0.gyro.y` 等）、**`motor.drive`**、サーボ **`wait until` 完了** などの高水準API
- serial の `line_ready` event や `read host.line`
- ownership / single-writer checker 本実装（Phase 2: まず `var` の `set` 競合など最小診断から）
- OLED の text API や SSD1306 物理互換

### フェードイン・フェードアウト（animator）

**`task every` 内**で `animator ramp` + `step` + `pwm#0.level` により滑らかなフェードが書ける。ブラウザ右パネルで **pwm#0** のレベルバーを確認できる。

**固定端点**（`ramp from … to …`）では **`step <name> with dt`** のみ。経過時間は内部で積算され、宣言した端点へ向かう **one-shot ramp**。

```text
ref led = pwm#0
var led_level = 0%
animator fade_in = ramp from 0% to 100% over 1200ms ease ease_in_out

task fade every 16ms {
  set led_level = step fade_in with dt
  do led.level(led_level)
}
```

**目標値ドリブン**（`ramp over …` のみ）では **`step <name> with <target> dt`**。`target` は整数パーセント式（`var` や `+` など）。目標が変わると **現在値から新目標へ** ramp が再始動する。目標が変わらない tick では完了後は値が揺れない。実行時に **0–100 外の整数** は `pwm.level` と同様に clamp。`task on` / `task loop` / var 初期値では引き続き `dt` / `step` は使えない（イベント側は `set led_target = …` のみ、周期 task が `step`）。

```text
ref led = pwm#0
var led_target = 100%
var led_level = 0%
animator fade = ramp over 1200ms ease ease_in_out

task apply every 16ms {
  set led_level = step fade with led_target dt
  do led.level(led_level)
}
```

従来どおり、`wait` と固定値の `pwm#0.level` を並べる書き方も引き続き有効。

```text
ref led = pwm#0
ref button = button#0

task fade_out on button.pressed {
  do led.level(100)
  wait 80ms
  do led.level(75)
  wait 80ms
  do led.level(50)
  wait 80ms
  do led.level(25)
  wait 80ms
  do led.level(0)
}
```

未対応なのは、`draft.md` が想定する **`animator` の高度なライフサイクル API**、負の `%`、および **`ease` の追加種類** など。

### その他の重要な未対応:
- `match` の拡張（nested `match`、branch 内 `wait`）。
- single-writer / ownership checker の本実装。
- `draft.md` 全文との完全整合。
- `display#0` の text API。
- serial input / stream 系の拡張。
- SSD1306 物理互換。

## 次にやるべきこと

1. Interactive task body を full compiler と同じ意味に近づける。
   - 重要度: 高
   - 難易度: 高
   - リスク: 高
   - 理由: 端末経路と script textarea 経路の差が、ユーザーにとって分かりにくい。

2. `match` をさらに draft に近づける。
   - 重要度: 高
   - 難易度: 高
   - リスク: 高
   - 理由: range expression match は入ったが、nested match や branch 内 `wait` を許すには execution frame stack が必要。

3. single-writer / ownership checker を実装する。
   - 重要度: 中
   - 難易度: 高
   - リスク: 高
   - 理由: 実行前に競合を検出する StaticCore Script らしさに関わる。

4. Device Model を拡張する。
   - 重要度: 中
   - 難易度: 中
   - リスク: 中
   - 候補: display text、serial input、追加 device API。

## 旧 Phase 1 メモ

Phase 1 は次の順で実装済み。

- 6.1 `read` を式として使う（`serial-read-adc.sc`）
- 6.2 `var` / `set` と永続束縛（`circle-animation.sc`）
- 6.3 `wait`（`tests/integration/wait-task-runtime.test.ts`）
- 6.4 `task on` と event source（`tests/integration/task-on-button-runtime.test.ts`）
- 6.5 `match` 最小形（`match-string-command.sc`）

残りは 6.6 single-writer / ownership の本実装。
