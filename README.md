# Kibo Script

## このドキュメントの責務

このドキュメントは、Kibo Script の現在地と、将来的に Raspberry Pi Pico 系ボード上で動作させるための方向性を共有するための入口である。

詳細な現状は [`STATUS.md`](STATUS.md)、言語の使い方は [`CHEATSHEET.md`](CHEATSHEET.md)、仕様メモは [`draft.md`](draft.md)、Pico 実機確認メモは [`docs/pico-bringup.md`](docs/pico-bringup.md)、runtime conformance（trace / IR contract / C++ host replay）の入口は [`docs/runtime-conformance.md`](docs/runtime-conformance.md) を参照する。runtime / Pico 対応の引き継ぎと次タスクは [`docs/runtime-pico-handoff.md`](docs/runtime-pico-handoff.md) にまとめている。

## 現在の位置づけ

Kibo Script は、教育用・小型ロボット用のスクリプト言語とシミュレーターを目指している。

現状は TypeScript 実装のブラウザ/テスト向けシミュレーターとして、次の流れが動作している。

```text
Kibo Script source
  -> lexer / parser
  -> binder
  -> type check / semantic check
  -> runtime IR
  -> SimulationRuntime
  -> virtual devices
```

実装済みの主な要素:

- `task every` / `task on` / `task loop`
- `var` / `const` / `temp`
- `set` / `do` / `wait` / `if` / `match`
- 状態機械 `state ... every ... initial ...`
- `.elapsed` による状態滞在時間参照
- `task ... in state.path` による状態 membership
- `on enter` / `on exit`
- **runtime world**: `ref` / `var` / task / 状態機械のメタデータを SimulationRuntime が保持し、`list refs` / `list vars` / `list states` と `compileScriptAgainstRuntimeWorld()`（incremental / additive 登録）でターミナル・複数 script と整合させる
- `display#0` の OLED 風 128x64 framebuffer
- `button#0.pressed` イベント
- LED / PWM / ADC / IMU / motor / servo / serial などの仮想デバイス

## 将来目標: Raspberry Pi Pico 対応

将来的には、Kibo Script を Raspberry Pi Pico 系ボード上で動作できるようにしたい。

主な対象:

- Raspberry Pi Pico / Pico W などの RP2040 系
- Raspberry Pi Pico 2 などの RP2350 系

初期 bring-up では、Raspberry Pi Pico + SSD1306 128x64 OLED + ボタン入力の最小実機確認が済んでいる。確認済みのピン割り当てと未確認事項は [`docs/pico-bringup.md`](docs/pico-bringup.md) に記録する。

Pico 上で TypeScript の compiler を直接動かすのではなく、PC / ブラウザ / CLI 側で検証済みの中間表現へ変換し、Pico 側では小さな runtime がそれを実行する方針とする。

```text
PC / browser / CLI
  Kibo Script source
    -> compiler
    -> compact IR / bytecode

Raspberry Pi Pico firmware
  C++17 runtime
    -> scheduler
    -> state machine engine
    -> expression evaluator
    -> device drivers
```

## C++17 Runtime 方針

Pico 側は独自 OS というより、Pico SDK 上で動作する Kibo Script 専用の C++17 runtime firmware として設計する。

runtime が担当するもの:

- bytecode / compact IR の読み込み
- `var` / `const` / `temp` の値管理
- cooperative task scheduler
- `every` / `loop` / `on event` の実行
- `wait` の再開管理
- 状態機械 tick
- active leaf state の管理
- `.elapsed` の解決
- `task ... in ...` の membership 判定
- `on enter` / `on exit` lifecycle dispatch
- device abstraction
- button / display / LED / PWM / motor / servo / sensor などの Pico 実デバイス接続

## Host Simulation 方針

Pico 実機が無くても正しさを確認できるように、C++17 runtime core は platform 非依存にする。

```text
kibo-runtime-core
  scheduler / VM / state machine / expression evaluator

kibo-runtime-host
  fake clock / fake GPIO / fake I2C / fake display
  unit tests / golden framebuffer tests

kibo-runtime-pico
  Pico SDK adapter
  real GPIO / I2C / PWM / flash / USB serial
```

この構成により、本体が無い状態でも次を検証できるようにする。

- bytecode が正しく読める
- task が期待通り起動する
- state machine が期待通り遷移する
- `.elapsed` が期待通り進む
- button event で mode が切り替わる
- OLED framebuffer が期待通りになる

実機テストは、最終的な pin mapping、I2C OLED 初期化、USB serial 転送、電源・配線・タイミング確認に集中させる。

## 推奨ロードマップ

1. 現在の `CompiledProgram` を Pico 向け IR schema として整理する。
2. IR を JSON ではなく、C++ runtime が読みやすい compact binary / bytecode へ落とす。
3. C++17 の host runtime を作り、PC 上で scheduler / expression / state machine をテストする。
4. `led#0`、`button#0`、`display#0` だけを対象に最小 firmware を作る。
5. OLED + button + state machine サンプルを host と Pico 実機の両方で動かす。
6. PWM / motor / servo / sensor 系を段階的に追加する。
7. USB serial などで bytecode を転送し、flash 保存できるようにする。
8. bytecode verifier、version check、panic report、watchdog などを追加して堅牢化する。

## 非目標

初期段階では次を目標にしない。

- Pico 上で lexer / parser / typechecker を実行すること
- 汎用 OS を作ること
- RP2040/RP2350 の peripheral を完全エミュレートすること
- C++ コード生成だけに依存し、スクリプト差し替えに毎回 firmware rebuild が必要な構成にすること

まずは、PC 側 compiler と Pico 側 C++17 runtime を分離し、同じ script の意味がシミュレーター・host runtime・実機 runtime で揃うことを重視する。
