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

`task` 本体で、`match <文字列式> { "ケース" => { ... } ... else => { ... } }` が使える。分岐の本体は `do` / `set` のみ（分岐内の `wait` は compile エラー）。

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
- branch 内は `do` / `set` のみ（`wait` と nested `match` は未対応）

## `wait` で task を一時停止する

full compiler 経路（script textarea / embed loadScript）では `wait <N>ms` が使える。次の例は LED を ON にして 100ms 後に OFF にする。

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
- `task on` の本体や `state` の初期値では `dt` / `step` は使えない。

```text
ref led = pwm#0
state led_level = 0%
animator fade_in = ramp from 0% to 100% over 1200ms ease ease_in_out

task fade every 16ms {
  set led_level = step fade_in with dt
  do led.level(led_level)
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

