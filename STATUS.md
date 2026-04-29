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

Phase 0 でまだ **ない** もの: `match`、`wait`、`state` / `set` の本格対応、所有規則の本実装、`draft.md` 全文。

### Compiler Phase 1 マイルストーン（分割）

`draft.md` 全体を一括ではなく、次の順で fixture を追加しながら進める。

- 6.1 `read` を式として使う（例: `serial.println` の引数）と UART 系サンプル
- 6.2 `state` / `set` と永続束縛
- 6.3 `wait`（task 内の遅延文）
- 6.4 `task on` とイベント源（例: `button#0`）
- 6.5 `match`（構文・型の最小検査）
- 6.6 single-writer / ownership の本実装

回帰用に golden を増やす（例: 現時点で `serial-print-task.sc` が追加済み）。

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

`task <name> every <N>ms { ... }` で登録された task は raw body テキストを保持する。登録時に body 内の各行を解析し、**対応する `do` 系列のみ**を `ExecutableStatement[]` へ変換して `compiledStatements` に保存する。対応していない行（例: `read adc#0`）があると登録は **失敗**し structured diagnostics を返す。

`compileScript()` で生成した `CompiledProgram` を `registerCompiledProgramOnTaskRegistry()` で載せた task も、同じく **`compiledStatements`** 経由で `tick()` の interval 到達時に `DeviceEffect` がキューされ、同じ tick 内で適用される。

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
| Embed `simulator.getSnapshot` に `led0.on` | 実装済み | 同上 |
| interactive `task every` body に `read` / `list tasks` など | 未対応 | body は対応する `do` 文に限定。それ以外は登録失敗 |
| single-writer の本実装 | 未実装 | Phase 0 では空の検査骨格のみ |

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

`simulator.getSnapshot` の `outputs` は `adc0.raw=...` と `led0.on=...` を返す。

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

### Interactive `task every` body の全構文

body は **LED / serial / display 向けの `do` 行**に限定している。`read` や複文法は登録時に拒否される。

### Full Parser / Compiler の Phase 1 未完了部分

`draft.md` の残りの構文と検査を広げる（例: `match`、`wait`、`state` / `set`、`temp`、`task on`、所有規則の本実装、interactive と compiler の収束など）。マイルストーンは上記「Compiler Phase 1 マイルストーン」を参照。

### SSD1306 物理互換

現在の `display#0` は StaticCore Script から見える表示デバイスであり、SSD1306 の完全エミュレータではない。

未対応:

- I2C / SPI command
- SSD1306 page addressing
- GDDRAM layout
- Adafruit SSD1306 互換 API

### ブラウザ E2E テスト

サーバー不要の自動テストはあるが、Playwright などによるブラウザ E2E テストはまだない。

現時点では、UI の主要ロジックは unit/integration test に寄せている。

## 次にやるべきこと

### 1. Compiler Phase 1（6.1 から順に fixture 駆動）

優先度: 高  
難易度: 高  
リスク: 高

### 2. Interactive task body と full compiler の機能 parity

優先度: 中  
難易度: 高  
リスク: 高

body 内で `read` 結果を `println` に渡すなど、compiler と同じ意味になるよう段階的に広げる。

### 3. Device Model を増やす

優先度: 中  
難易度: 中  
リスク: 中

候補:

- `pwm#0`
- `button#0`
- `display#0` の text / rect / fill API
- `serial#0` の line input

## LED 点滅を可能にするための最短ルート

ブラウザでは **テキストエリアから compile**、または **端末で `task ... { do led#0.toggle() }`** で `tick` と連動する。

追加で改善できること:

- interactive task body に compiler と同等の式・制御構文を載せる。
- Playwright などによるブラウザ E2E。

## 現時点のまとめ

現在の実装は、StaticCore Script シミュレータの MVP として次の状態にある。

- 端末は動く。
- ADC は読める。
- serial 出力はできる。
- OLED 風 display は描画できる。
- structured diagnostics は出せる。
- task registry はある。
- embed API の土台はある。
- full compiler Phase 0（`compileScript` / golden fixtures）がある。
- 端末・ブラウザテキストエリア・embed の各経路から script / task を載せられる。
- LED の状態が UI と snapshot で確認できる。

未完了の主な領域は、compiler Phase 1 の構文拡張と、interactive task body と compiler の意味を揃える作業である。
