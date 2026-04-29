# StaticCore Script Simulator Status

## このドキュメントの責務

このドキュメントは、ブラウザ版 StaticCore Script Simulator の現状を短く把握できるように、「できていること」「制限」「次にやること」を整理するためのメモである。

すぐ試すための例は [`CHEATSHEET.md`](CHEATSHEET.md) を参照する。

## 現在の要約

MVP として、ブラウザ UI・仮想デバイス・task runtime・full compiler の縦断ルートは動作している。

- ブラウザで端末、script runner、OLED 風 canvas、LED ランプ、**pwm#0 レベル（バー + テキスト）**、`button#0` の Press UI を表示できる。
- `compileScript()` で複数行 script を parse / bind / type check / semantic check し、runtime IR に下げられる。
- `state` / `set`、式、`read`、`wait`、`task on`、`match` 最小形まで実装済み。
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
- `npm test`: 成功（30 files / 73 tests）
- `npm run build`: 成功
- `npm run test:e2e`: 成功（3 tests）

## ブラウザ UI

ブラウザ上で次を操作できる。

- Interactive terminal: 1 行 command、task 操作、diagnostics 表示。
- StaticCore Script textarea: 複数行 script を compile して runtime に登録。
- `display#0`: 128x64 の 1bit framebuffer を OLED 風 canvas に描画。
- `led#0`: on/off をランプで表示。
- `pwm#0`: 0–100% の level をバーと数値で表示（script の `pwm#0.level` と同期）。
- `button#0`: Press ボタンで `button#0.pressed` event を dispatch。

関連ファイル:

- `src/ui/simulator-view.ts`
- `src/ui/script-runner-view.ts`
- `src/ui/led-view.ts`
- `src/ui/pwm-view.ts`
- `src/ui/button-view.ts`
- `src/ui/styles.css`

## Interactive Command

端末欄では、主に 1 行単位の確認と task 操作ができる。

```text
read adc#0
adc#0.info
display#0.info
led#0.info
button#0.info
pwm#0.info
do serial#0.println("text")
do display#0.clear()
do display#0.pixel(x, y)
do display#0.line(x0, y0, x1, y1)
do display#0.circle(x, y, radius)
do display#0.present()
do led#0.on()
do led#0.off()
do led#0.toggle()
task <name> every <N>ms { do ... }
list tasks
show task <name>
start task <name>
stop task <name>
drop task <name>
```

制限:

- interactive task body は現状 1 行 1 つの `do ...` のみ。
- interactive task body で `state` / `set` / `wait` / `match` を使うには、今後 body parser を拡張する必要がある。
- これらの構文を使う場合は、現状では script textarea の full compiler 経路を使う。

## 仮想デバイス

実装済みデバイス:

- `adc#0`: raw 値を読める。Embed から値を設定できる。
- `serial#0`: `println` による出力を保持できる。
- `display#0`: `clear` / `pixel` / `line` / `circle` / `present` に対応。
- `led#0`: `on` / `off` / `toggle` に対応。
- `pwm#0`: `level(percent)` に対応。0-100% に clamp する。
- `button#0`: UI / embed / test から押下状態を注入できる。

未対応:

- `display#0` の text 描画 API。
- `serial#0` の高度な line input / stream 処理。
- SSD1306 物理互換の I2C / SPI command、page addressing、GDDRAM layout。

## Full Compiler

入口は `src/compiler/compile-script.ts` の `compileScript(sourceText, fileName)`。

成功時は `src/core/executable-task.ts` の `CompiledProgram` を返し、`SimulationRuntime.replaceCompiledProgram()` が state 初期化と task 登録を行う。失敗時は `DiagnosticReport` を返す。

実装済みの主な構文:

- `ref`
- `state`
- `task <name> every <N>ms`
- `task <name> on <device#id>.<event>`
- `task <name> on <ref>.<event>`
- `do <device/ref>.<method>(...)`
- `set <state> = <expression>`
- `wait <N>ms`
- `read <device#id>` 式
- `match <string-expression> { "literal" => { ... } else => { ... } }`

式 IR:

- integer literal
- string literal
- state reference
- binary `+`
- device read

`match` 最小形の制限:

- statement としてのみ使う。
- target は string 式のみ。
- pattern は string literal と `else` のみ。
- `else` は必須。
- branch 内は `do` / `set` のみ。
- branch 内 `wait`、nested `match`、範囲 pattern、`temp` は未対応。

## Runtime

`SimulationRuntime` は compiled task を cooperative に進める。

- `every` task は `tick(elapsedMilliseconds)` で時間を進める。
- `wait` は `resumeAtTotalMilliseconds` により再開時刻を持つ。
- `task on` は `dispatchScriptEvent({ deviceAddress, eventName })` で同期的に起動する。
- `match_string` は対象式を評価し、該当 branch だけを実行する。
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
```

response は成功時 `ok: true`、失敗時 `ok: false` と structured diagnostics を返す。

## Diagnostics

エラーは JSON 互換の structured diagnostics として返す。

代表例:

- `compiler.empty_script`
- `parse.unsupported_command`
- `parse.unexpected_token`
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
- `runtime.out_of_range`
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
- `state` / `set` / `read` / `wait` / `task on` / `match`
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
- `tests/integration/task-on-button-runtime.test.ts`
- `tests/integration/match-string-runtime.test.ts`
- `tests/e2e/script-runner-led.spec.ts`
- `tests/e2e/script-runner-button.spec.ts`
- `tests/e2e/script-runner-pwm.spec.ts`

## `draft.md` との差分と現在の制限

現状は MVP + Phase 1 の一部であり、`draft.md` 全体の実装ではない。

できること:

- `ref` / `state` / `set` / `read` / `wait`
- `task every` / `task on`
- 文字列 `match` の最小形
- `led#0` の on / off / toggle
- `pwm#0.level(number)` による PWM 出力値の変更
- **animator v1**: `animator ... = ramp from A% to B% over Nms ease linear|ease_in_out`、**`dt`**（`task every` の名目間隔 ms）、**`step <name> with dt`** による 1 ショット ramp（`task on` や state 初期化では `dt` / `step` 不可）
- **パーセントリテラル** `0%`…`100%`（v1 では整数パーセントに下ろす）
- `display#0` の基本図形描画（clear / pixel / line / circle / present）

まだできないこと:

- `const` / `temp` / `range`
- `%` を独立した型としての完全実装（角度や別単位との混合など）
- `filter` / `estimator` / `controller`
- **animator の restart / pause / reverse、`do animator.start()` 等のメソッド**
- `match` の範囲 pattern、式としての `match`、nested `match`
- `loop`、`wait until`、`else return`
- `IMU` / `motor` / `servo`
- serial の `line_ready` event や `read host.line`
- ownership / single-writer checker 本実装
- OLED の text API や SSD1306 物理互換

### フェードイン・フェードアウト（animator v1）

**`task every` 内**で `animator ramp` + `step ... with dt` + `pwm#0.level` により滑らかなフェードが書ける。ブラウザ右パネルで **pwm#0** のレベルバーを確認できる。

```text
ref led = pwm#0
state led_level = 0%
animator fade_in = ramp from 0% to 100% over 1200ms ease ease_in_out

task fade every 16ms {
  set led_level = step fade_in with dt
  do led.level(led_level)
}
```

**v1 の制限**: program load 時に animator は初期化される **one-shot ramp**。`task on` や state 初期値では `dt` / `step ... with dt` は使用できない。ボタンから同一 animator を繰り返し再起動する API は未実装。

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

未対応なのは、`draft.md` が想定する **`animator` の高度なライフサイクル**、負の `%`、および **`ease` の追加種類** など。
### その他の重要な未対応:
- `match` の拡張（範囲 pattern、nested `match`、branch 内 `wait`）。
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

2. `match` を draft に近づける。
   - 重要度: 高
   - 難易度: 高
   - リスク: 高
   - 理由: branch 内 `wait` を許すには execution frame stack が必要。

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
- 6.2 `state` / `set` と永続束縛（`circle-animation.sc`）
- 6.3 `wait`（`tests/integration/wait-task-runtime.test.ts`）
- 6.4 `task on` と event source（`tests/integration/task-on-button-runtime.test.ts`）
- 6.5 `match` 最小形（`match-string-command.sc`）

残りは 6.6 single-writer / ownership の本実装。
