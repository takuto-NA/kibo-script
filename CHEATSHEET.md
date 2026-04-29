# StaticCore Script Simulator Cheatsheet

## このドキュメントの責務

このドキュメントは、今のシミュレータで「すぐ試せること」を短くまとめるための早見表である。

詳細な対応状況は [`STATUS.md`](STATUS.md) を参照する。

## 起動

```text
npm run dev -- --host 127.0.0.1
```

ブラウザで表示された `Local:` の URL を開く。

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

## Interactive Command

端末欄では 1 行ずつ実行できる。

```text
read adc#0
adc#0.info
display#0.info
led#0.info
```

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

## Interactive Task

端末から task を登録できる。

```text
task blink every 1000ms { do led#0.toggle() }
```

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

## 今できないこと

次はまだ Phase 1 以降。

- `state` / `set`
- `wait`
- `task on`
- `match`
- single-writer / ownership checker の本実装
- `draft.md` 全体の compile

