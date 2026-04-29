# StaticCore Script Simulator Cheatsheet

## このドキュメントの責務

このドキュメントは、今のシミュレータで「すぐ試せること」を短くまとめるための早見表である。

詳細な対応状況は [`STATUS.md`](STATUS.md) を参照する。

## 起動

```text
npm run dev -- --host 127.0.0.1
```

ブラウザで表示された `Local:` の URL を開く。

回帰確認（ローカル）:

```text
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --audit-level=moderate
```

## 複数行 script を動かす

ブラウザ上部の script textarea に次を入れて、`Compile & run on simulator` を押す。

```text
ref led = led#0

task blink every 1000ms {
  do led.toggle()
}
```

期待動作:

- compile 成功
- `blink` task が登録される
- `led#0` ランプが 1 秒ごとに ON / OFF する

## `task loop`（周期なしの状態遷移）

`task patrol loop { ... }` は **周期タイマを持たない**。本体が最後まで進むと先頭へ戻るが、協調的スケジューラのため **各シミュレーション tick で少しずつ進む**（`wait` で明示的に時間を渡す）。

```text
state step = 0

task patrol loop {
  set step = 1
  wait 250ms
  set step = 2
  wait 250ms
}
```

制限（Phase 1）:

- loop task は **少なくとも 1 つの `wait` が必要**（`match` 分岐内はカウントしない）。
- `if` 分岐の中に `wait` は書けない（`task every` / `task on` / `task loop` 共通）。

## `button#0` を画面から押す（`task on`）

右側パネルに **button#0** と **Press** ボタンがある。次の script を textarea に入れて `Compile & run on simulator` のあと、**Press** を押すと LED が切り替わる。

```text
ref led = led#0
ref button = button#0

task react on button.pressed {
  do led.toggle()
}
```

`task on` のイベント元は `button#0.pressed` の直書きでも、上のように `ref button = button#0` 経由でも書ける。

## `match`（文字列の最小形）

`task` 本体で、`match <文字列式> { "ケース" => { ... } ... else => { ... } }` が使える。分岐の本体は `do` / `set` / `temp` / `if`（`match` 分岐内の `wait` / nested `match`、および `if` 分岐内の `wait` は compile エラー）。

```text
state mode = "on"

ref led = led#0

task apply on button#0.pressed {
  match mode {
    "on" => { do led#0.on() }
    "off" => { do led#0.off() }
    else => { do serial#0.println("ERR") }
  }
}
```

制限:

- target は string 式のみ
- pattern は string literal と `else` のみ
- `else` は必須
- branch 内は `do` / `set` / `temp` / `if`（`match` 分岐内の `wait` / nested `match`、`if` 分岐内の `wait` は未対応）

## `const` / `temp`（名前付き値）

マジックナンバーを避けるために、`const`（プログラム全体で不変）と `temp`（同一 task 実行内のみ）が使える。

```text
const max_x = 127
state x = 64

task move every 20ms {
  temp next_x = x + 1
  if next_x > max_x {
    set x = 0
  } else {
    set x = next_x
  }
}
```

- `set` で const を書き換えようとすると compile エラー
- `temp` は宣言より前の行では参照できない

## 式（算術・比較・`match` 式）

`+` `-` `*` `/`（除算は `trunc` 方向）、単項 `-`、`==` `!=` `<` `<=` `>` `>=` が式で使える。`*` `/` は `+` `-` より強く結合する。

数値の分岐には `match <式> { pattern => 式, ... }` の **式** 形がある。範囲は draft どおり **左閉右開**（`a..b`、`..b`、`a..`）。必要なら `else => 式` でフォールバック。

```text
temp lane =
  match x {
    0 => 0
    10..20 => 1
    else => 2
  }
```

## 最小 `if` 文

条件は比較式から。

```text
if score > 3 {
  do led#0.on()
} else {
  do led#0.off()
}
```

## `wait` で task を一時停止する

full compiler 経路（script textarea / embed loadScript）では `wait <integer-expression>ms` が使える（例: `wait 100ms` / `wait cruise_duration_ms ms`）。`wait` は **実行時に 1 回だけ**式を評価し、整数 ms として扱う（未評価・非整数・0 以下はその task を停止）。

次の例は LED を ON にして 100ms 後に OFF にする。

```text
task pulse every 1000ms {
  do led#0.on()
  wait 100ms
  do led#0.off()
}
```

## `read` 式を使う

`read adc#0` は整数式として `serial.println` などに渡せる。

```text
ref port = serial#0

task report every 1000ms {
  do port.println(read adc#0)
}
```

## `pwm#0` を使う

`pwm#0.level(<percent>)` で 0-100% の出力値を設定できる。

```text
task dim every 1000ms {
  do pwm#0.level(50)
}
```

## PWM フェード（animator v1）

`task every` の本体で、`animator ramp` と `step ... with dt` を使う。**右パネルの pwm#0** でレベル変化を確認できる。

- `%` は `0%`〜`100%` の整数パーセントとして解釈される。
- `dt` はその `task every <N>ms` の **名目間隔 N**（ミリ秒）。
- `task on` / `task loop` の本体や `state` の初期値では `dt` / `step` は使えない。

### 固定端点（`ramp from … to …`）

```text
ref led = pwm#0
state led_level = 0%
animator fade_in = ramp from 0% to 100% over 1200ms ease ease_in_out

task fade every 16ms {
  set led_level = step fade_in with dt
  do led.level(led_level)
}
```

### 目標値ドリブン（`ramp over …` + `step … with <target> dt`）

`animator` に端点を書かず、**`step` の引数で目標パーセント**を渡す。イベント側は `state` の目標だけ更新し、**`task every` だけが `step`** する（`draft.md` の方針）。

```text
ref led = pwm#0
ref button = button#0

state led_level = 0%
state led_target = 0%
state next_target = "on"

animator fade = ramp over 1200ms ease ease_in_out

task toggle on button.pressed {
  match next_target {
    "on" => {
      set led_target = 100%
      set next_target = "off"
    }
    "off" => {
      set led_target = 0%
      set next_target = "on"
    }
    else => { set next_target = "on" }
  }
}

task apply every 16ms {
  set led_level = step fade with led_target dt
  do led.level(led_level)
}
```

## 物理ローバーを走らせる

右パネルの **Physics** canvas で、固定筐体が直進・旋回・後退を繰り返す。`servo#0` のスキャナーが左右に振れ、後退フェーズでは筐体上の `led#0` と `pwm#0` のビーコンが強く光る。`serial#0` には `imu#0.yaw`（ミリ度）が流れる。

```text
ref left_motor = motor#0
ref right_motor = motor#1
ref scanner = servo#0
ref hull_led = led#0
ref glow = pwm#0
ref imu = imu#0

const scanner_min_degrees = -70
const scanner_step_degrees = 5
const scanner_edge_degrees = 70
const cruise_power_percent = 58
const turn_left_power_percent = 38
const turn_right_power_percent = 62
const reverse_left_power_percent = -54
const reverse_right_power_percent = -28
const dim_glow_percent = 35%
const warning_glow_percent = 100%

const cruise_duration_ms = 1280
const turn_duration_ms = 1280
const reverse_duration_ms = 1280

state scanner_angle_degrees = scanner_min_degrees
state scanner_direction = 1
state glow_level = 0%
state glow_target = 35%

state left_power_target = 0
state right_power_target = 0
state warning_enabled = 0

animator glow_fade = ramp over 360ms ease ease_in_out

task patrol loop {
  set warning_enabled = 0
  set glow_target = dim_glow_percent
  set left_power_target = cruise_power_percent
  set right_power_target = cruise_power_percent
  wait cruise_duration_ms ms

  set left_power_target = turn_left_power_percent
  set right_power_target = turn_right_power_percent
  wait turn_duration_ms ms

  set warning_enabled = 1
  set glow_target = warning_glow_percent
  set left_power_target = reverse_left_power_percent
  set right_power_target = reverse_right_power_percent
  wait reverse_duration_ms ms
}

task apply_outputs every 32ms {
  if warning_enabled != 0 {
    do hull_led.on()
  } else {
    do hull_led.off()
  }

  do left_motor.power(left_power_target)
  do right_motor.power(right_power_target)
}

task scan_and_report every 32ms {
  temp next_scanner_angle_degrees = scanner_angle_degrees + scanner_direction * scanner_step_degrees
  set scanner_angle_degrees = next_scanner_angle_degrees

  if scanner_angle_degrees > scanner_edge_degrees {
    set scanner_direction = -1
  } else {
    set scanner_direction = scanner_direction
  }

  if scanner_angle_degrees < scanner_min_degrees {
    set scanner_direction = 1
  } else {
    set scanner_direction = scanner_direction
  }

  do scanner.angle(scanner_angle_degrees)

  set glow_level = step glow_fade with glow_target dt
  do glow.level(glow_level)

  temp yaw_mdeg = read imu#0.yaw
  do serial#0.println(yaw_mdeg)
}
```

## Interactive Command

端末欄では 1 行ずつ実行できる。

```text
read adc#0
adc#0.info
display#0.info
led#0.info
button#0.info
pwm#0.info
```

`adc#0.info` は複数行テキストになる（改行がそのまま表示される）。

```text
do serial#0.println("hello")
do led#0.on()
do led#0.off()
do led#0.toggle()
do pwm#0.level(20)
```

```text
do display#0.clear()
do display#0.pixel(10, 20)
do display#0.line(0, 0, 127, 63)
do display#0.circle(64, 32, 8)
do display#0.present()
```

## Circle を動かす（Phase 1: `state` / `set` 対応）

ブラウザの **script textarea** に次を入れて `Compile & run` すると、座標が毎 tick 更新される。

```text
state circle_x = 20

task move_circle every 100ms {
  do display#0.clear()
  do display#0.circle(circle_x, 32, 8)
  do display#0.present()
  set circle_x = circle_x + 4
}
```

端末の `do display#0.circle(20, 32, 8)` のように 1 フレームずつ手で変える方法も引き続き有効。

## 旧: 手動 1 フレームずつ

```text
do display#0.clear()
do display#0.circle(20, 32, 8)
do display#0.present()
```

```text
do display#0.clear()
do display#0.circle(40, 32, 8)
do display#0.present()
```

```text
do display#0.clear()
do display#0.circle(60, 32, 8)
do display#0.present()
```

変数で Circle を動かすアニメーションは **上記の `state` / `set` 付き script** を利用（full compiler 経路）。

## Interactive Task

端末から task を登録できる。

```text
task blink every 1000ms { do led#0.toggle() }
```

Interactive task body は現状 1 行 1 つの `do ...` のみ。`state` / `set` / `wait` / `match` を使う場合は script textarea の full compiler 経路を使う。

task 操作:

```text
list tasks
show task blink
stop task blink
start task blink
drop task blink
```

## よくある確認

LED の状態を見る:

```text
led#0.info
```

画面をクリアして 1 点描画:

```text
do display#0.clear()
do display#0.pixel(10, 20)
do display#0.present()
```

不正な単位の diagnostics を確認:

```text
ref led = led#0

task blink every 1000deg {
  do led.toggle()
}
```

## 今できないこと / 制限

- `match` の範囲パターン、`match` のネスト、分岐内の `wait`
- single-writer / ownership checker の本実装
- `draft.md` 全文の compile

次の拡張候補:

- interactive `task every` body に `set` / `state` / `wait` / `read` 式（現状 body は 1 行 1 `do` のみ、full compiler 経路で上記を利用する）
- `display#0` の text 等、追加 API

