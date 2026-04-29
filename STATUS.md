# StaticCore Script Simulator Status

## このドキュメントの責務

このドキュメントは、現在のブラウザシミュレータで「できていること」「まだできていないこと」「次に実装すべきこと」を整理するための現状メモである。

対象は `draft.md` にある StaticCore Script のブラウザ実行シミュレータで、現時点では MVP 実装の状態をまとめる。

## 現在できていること

### プロジェクト基盤

- TypeScript + Vite + Vitest のブラウザアプリとして起動できる。
- `npm run dev` で開発サーバーを起動できる。
- `npm run typecheck`、`npm test`、`npm run build` で検証できる。
- `npm audit --audit-level=moderate` で脆弱性がない状態を確認済み。

### ブラウザ UI

- ブラウザ上に端末 UI を表示できる。
- 端末からコマンドを入力できる。
- コマンドの入力履歴と出力を表示できる。
- structured diagnostics の JSON を端末内に表示できる。
- 128×64 OLED 風の canvas 表示領域を持つ。

- 端末の上に **StaticCore Script** 用のテキストエリアから `compileScript` して task を登録できる。
- `led#0` の on/off をランプ表示できる。
- **`button#0`**: 右パネルに `Press` ボタンがあり、クリックで `button#0.pressed` 向け `task on` を起動できる（`data-testid="simulator-button0-press"`）。

### Interactive Command

次のコマンドは動作する。

```text
read adc#0
adc#0.info
display#0.info
led#0.info
do serial#0.println("text")
do display#0.clear()
do display#0.pixel(x, y)
do display#0.line(x0, y0, x1, y1)
do display#0.circle(x, y, radius)
do display#0.present()
do led#0.on()
do led#0.off()
do led#0.toggle()
list tasks
show task <name>
start task <name>
stop task <name>
drop task <name>
task <name> every <N>ms { ... }
```

### 仮想デバイス

実装済みのデバイスは次の通り。

- `adc#0`
  - 固定または外部指定された raw 値を返せる。
  - `read adc#0` で値を読める。
  - `adc#0.info` で情報を表示できる。
- `serial#0`
  - `do serial#0.println("text")` 相当の出力を端末ログに出せる。
- `display#0`
  - 128×64 の 1bit framebuffer を持つ。
  - `clear`、`pixel`、`line`、`circle`、`present` に対応している。
  - `present()` までは draft buffer に描画し、`present()` で表示済み frame に反映する。
  - canvas へ OLED 風に描画できる。
- `led#0`
  - `DeviceEffect` 経由で `on` / `off` / `toggle` の状態遷移ができる。
  - `read` / `led#0.info` 相当の用途は `readProperty` から利用できる（full compiler パスは `ref` 束縛を使用）。

### Full compiler（Phase 0 縦断ルート）

次の multiple-line script を `compileScript()` で **parse / bind / type / semantic** し、`CompiledProgram`（runtime IR）を生成できる。

```text
ref led = led#0

task blink every 1000ms {
  do led.toggle()
}
```

- 入口: `src/compiler/compile-script.ts` の `compileScript(sourceText, fileName)`。
- 失敗時は `DiagnosticReport`（`compiler.empty_script`、`parse.*`、`bind.*`、`type.*`、`semantic.*` 等）。
- 成功時 IR は `src/core/executable-task.ts` の `CompiledProgram`。
- `tests/compiler/fixtures/` に golden（`.sc` + `.expected.json`）がある（例: `serial-print-task.sc`）。

Phase 0 の縦断ルートを土台に、Phase 1 で `state` / `set`、`read` 式、`wait`、`task on`、**`match`（文字列の最小形）** まで拡張済み。未対応は `match` の拡張（範囲・ネスト・分岐内 `wait`）、所有規則の本実装、`draft.md` 全文。

### Compiler Phase 1（進捗）

fixture / integration で検証済みの項目:

- **式 IR**: `ExecutableExpression`（整数・文字列・`state_reference`・`binary_add`・`read_property`）
- **`state` / `set`** と display 引数の整数式（例: `circle-animation.sc`）
- **`read adc#0`** を `serial.println` の引数に（例: `serial-read-adc.sc`）
- **`wait`** と task 内遅延（`tests/integration/wait-task-runtime.test.ts`）
- **`task on`** と `dispatchScriptEvent`（`tests/integration/task-on-button-runtime.test.ts`）
- **`match`（文字列 target・文字列リテラル case・必須 else・IR `match_string`）**（golden: `match-string-command.sc` 等、`tests/integration/match-string-runtime.test.ts`）
- **`pwm#0`** / **`button#0`** デバイスモデルと Embed snapshot 拡張
- **Ownership**: Phase 0 と同様に検査骨格のみ（本実装は未）

未完了の主領域:

- **`match` の拡張**（範囲パターン、ネストした `match`、分岐内 `wait`）、interactive task body の `state`/`set`/`wait`、ownership の本実装、`draft.md` 全文。

### Compiler Phase 1 マイルストーン（旧メモ・参照用）

`draft.md` 全体を一括ではなく、次の順で fixture を追加しながら進める。

- 6.1 `read` を式として使う（例: `serial.println` の引数）と UART 系サンプル → **golden `serial-read-adc.sc`**
- 6.2 `state` / `set` と永続束縛 → **`circle-animation.sc`**
- 6.3 `wait`（task 内の遅延文）→ **integration**
- 6.4 `task on` とイベント源（例: `button#0`）→ **integration**
- 6.5 `match`（構文・型の最小検査）→ **golden `match-string-command.sc` 等**
- 6.6 single-writer / ownership の本実装

回帰用に golden を増やす（例: `serial-print-task.sc`、`blink-led.sc`、`circle-animation.sc`、`serial-read-adc.sc`、`button-toggle-on-event.sc`、`match-string-command.sc`）。

### Structured Diagnostics

エラーは JSON 互換の structured diagnostics として返せる。

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

現在確認済みの代表例:

- 未対応コマンド: `parse.unsupported_command`
- 存在しないデバイス: `device.unknown_target`
- 範囲外ピクセル: `runtime.out_of_range`
- 存在しない task: `task.unknown`
- full compiler: `compiler.empty_script`、`unit.type_mismatch`、`name.unknown_reference`、`semantic.duplicate_task_name` など

### Task Registry

次の task 操作はできる。

- `task <name> every <N>ms { ... }` で task を登録する。
- `list tasks` で task 一覧を表示する。
- `show task <name>` で task 詳細を見る。
- `start task <name>` で task を running にする。
- `stop task <name>` で task を stopped にする。
- `drop task <name>` で task を削除する。

`task <name> every <N>ms { ... }` で登録された task は raw body テキストを保持する。登録時に body 内の各行を **full compiler 相当**（`compileDoStatementSourceLineToExecutableStatement`）で `ExecutableStatement[]` へ変換し `compiledStatements` に保存する。パース / bind / 型に失敗した行があると登録は **失敗**し structured diagnostics を返す。

`compileScript()` 経路は `SimulationRuntime.replaceCompiledProgram()` が **script state 初期化**と task 再登録をまとめて行う。`every` task は `compiledStatements` を `tick()` 上で `wait` / `set` 含め段階実行し、Effect をキューしてフラッシュする。

### 実行経路別の対応状況

| 実行経路 / 機能 | 状態 | 確認方法 / 補足 |
| --- | --- | --- |
| `compileScript()` で複数行 script を compile | 実装済み | `tests/compiler/compile-script.test.ts`、`tests/compiler/fixture-runner.test.ts` |
| `ref led = led#0` の名前解決 | 実装済み | `tests/compiler/binder.test.ts` |
| `task blink every 1000ms { do led.toggle() }` の IR 生成 | 実装済み | `tests/compiler/fixtures/blink-led.sc` と `blink-led.expected.json` |
| `CompiledProgram` を `TaskRegistry` に登録 | 実装済み | `registerCompiledProgramOnTaskRegistry()` |
| `SimulationRuntime.tick()` で compiled task を発火 | 実装済み | `tests/integration/compiler-runtime.test.ts` |
| `tick(999)` では LED 変化なし、`tick(1)` で toggle | 実装済み | `tests/integration/compiler-runtime.test.ts` |
| `led#0` の仮想デバイス状態 | 実装済み | `tests/devices/led-device.test.ts` |
| `every 1000deg` の単位エラー | 実装済み | `unit.type_mismatch`、`tests/compiler/type-checker.test.ts`、`invalid-unit.expected.json` |
| 未定義 ref の診断 | 実装済み | `name.unknown_reference`、`tests/compiler/compile-script.test.ts` |
| interactive shell の `task every` body（LED / serial / display の `do` のみ）を `tick()` で実行 | 実装済み | `compileInteractiveEveryTaskBodyToExecutableStatements`、`tests/integration/interactive-gap-characterization.test.ts` |
| interactive shell から `do led#0.toggle()` | 実装済み | `tests/interactive/parse-interactive-command.test.ts` |
| ブラウザ UI で LED 状態を表示 | 実装済み | `src/ui/led-view.ts`、`src/ui/simulator-view.ts` |
| ブラウザ UI から複数行 script を compile/run | 実装済み | `src/ui/script-runner-view.ts`、`tests/ui/compile-and-register-script.test.ts` |
| Embed `simulator.loadScript` | 実装済み | `tests/embed/embed-controller.test.ts` |
| Embed `simulator.getSnapshot` に ADC / LED / PWM / button | 実装済み | 同上 |
| `state` / `set` / 式引数（Circle アニメ） | 実装済み | `tests/compiler/fixtures/circle-animation.sc`、`tests/integration/circle-state-animation.test.ts` |
| `read` + `serial.println` | 実装済み | `tests/compiler/fixtures/serial-read-adc.sc`、integration 可 |
| `wait` 文 | 実装済み | `tests/integration/wait-task-runtime.test.ts` |
| `task on` + イベント | 実装済み | `tests/integration/task-on-button-runtime.test.ts`、`dispatchScriptEvent` |
| UI **`button#0` Press**（ブラウザ） | 実装済み | `src/ui/button-view.ts`、`tests/e2e/script-runner-button.spec.ts` |
| **`match`（最小・文字列）** | 実装済み | `tests/compiler/fixtures/match-string-command.sc`、`tests/integration/match-string-runtime.test.ts` |
| `pwm#0` / `button#0` | 実装済み | `src/devices/pwm-device.ts` / `button-device.ts`、snapshot に `pwm0` / `button0` |
| ブラウザ E2E（script runner + LED / **button**） | 実装済み | `npm run test:e2e`、`tests/e2e/script-runner-led.spec.ts`、`tests/e2e/script-runner-button.spec.ts` |
| interactive `task every` body（`do` のみ 1 行） | 実装済み | `compileDoStatementSourceLine` と同一 IR |
| interactive body に `set` / `wait` 等 | 未対応 | 将来: body 用パーサ拡張 |
| single-writer の本実装 | 未実装 | 検査骨格のみ |

### Embed API

Unity/WebView など別シミュレータ内で動かすための `postMessage` API の土台はある。

対応済み message:

```text
simulator.command
simulator.tick
simulator.getSnapshot
simulator.getDisplayFrame
simulator.setAdcValue
simulator.loadScript
```

`simulator.getSnapshot` の `outputs` は `adc0.raw=...`、`led0.on=...`、`pwm0.level=...`、`button0.pressed=...` を返す。

response は成功時 `ok: true`、失敗時 `ok: false` と structured diagnostics を返す。

### サーバー不要の自動テスト

スクリーンショットや開発サーバーに依存せず、次をテストできる。

- interactive command の parse/evaluate
- runtime と device bus
- `adc#0`
- `serial#0`
- `display#0` framebuffer
- OLED の RGBA 変換
- structured diagnostics
- embed message
- full compiler（lexer / parser / bind / type / semantic / fixture golden）
- UI の compile 経路（`compile-and-register-simulation-script`）
- embed の `loadScript` / snapshot

現時点の確認結果:

```text
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate
```

すべて成功済み。

## 現在できていないこと

### Interactive `task every` body の制限

body は **1 行 1 つの `do ...` のみ**（full compiler の `compileDoStatementSourceLineToExecutableStatement` と同一パイプライン）。`state` / `set` / `wait` を interactive task に載せるには構文拡張が必要。

### Full Parser / Compiler でまだ弱い部分

- **`match` の拡張**（範囲パターン、ネスト、分岐内 `wait`）
- **single-writer / ownership** の本実装（検査骨格のみ）
- **`draft.md` 全文**との完全一致

実装済み: `state` / `set`、式、`read`、`wait`、`task on`、`pwm` / `button`、**UI button + `match` 最小**、ブラウザ E2E（LED + button）。

### SSD1306 物理互換

現在の `display#0` は StaticCore Script から見える表示デバイスであり、SSD1306 の完全エミュレータではない。

未対応:

- I2C / SPI command
- SSD1306 page addressing
- GDDRAM layout
- Adafruit SSD1306 互換 API

### ブラウザ E2E テスト

Playwright による最小 smoke（`tests/e2e/script-runner-led.spec.ts`、`tests/e2e/script-runner-button.spec.ts`）。`npm run test:e2e`。

```text
npm run test:e2e
```

（初回のみ `npx playwright install chromium` が必要な場合あり。）

## 次にやるべきこと

### 1. `match` 文の拡張（範囲・ネスト・分岐内 `wait`）と Phase 1 残りの構文

優先度: 高  
難易度: 高  
リスク: 高

### 2. Interactive task body を複行文・`set` / `wait` まで拡張し full compiler と意味を揃える

優先度: 高  
難易度: 高  
リスク: 高

### 3. single-writer / ownership の本実装

優先度: 中  
難易度: 高  
リスク: 高

### 4. Device Model（display text / serial line input 等）

優先度: 中  
難易度: 中  
リスク: 中

## LED 点滅を可能にするための最短ルート

ブラウザでは **テキストエリアから compile**、または **端末で `task ... { do led#0.toggle() }`** で `tick` と連動する。

追加で改善できること:

- interactive task body に `state` / `set` / `wait` / 複数文を載せる。
- Playwright のカバレッジ拡大（操作パスの追加）。

## 現時点のまとめ

現在の実装は、StaticCore Script シミュレータの MVP として次の状態にある。

- 端末は動く。
- ADC は読める。
- serial 出力はできる。
- OLED 風 display は描画できる。
- structured diagnostics は出せる。
- task registry はある。
- embed API の土台はある。
- full compiler Phase 1 の主要構文（`state`、`read`、`wait`、`task on`、**`match` 最小**、デバイス拡張）がある。
- Playwright によるブラウザ E2E（LED + **button**）がある。
- 端末・ブラウザテキストエリア・embed の各経路から script / task を載せられる。
- LED の状態が UI と snapshot で確認できる。

未完了の主な領域は、`match` の拡張と ownership の本実装、interactive task body の複合構文対応、`draft.md` との完全整合である。
