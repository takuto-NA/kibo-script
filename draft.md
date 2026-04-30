StaticCore Script v0.5-draft

Language Specification

## 1. 目的

StaticCore Script は、小型デバイス向けの bounded かつ inspectable な制御スクリプト言語である。対象は LED、PWM、ボタン、ADC、IMU、サーボ、モーター、OLED、UART / USB serial を中心とする。

主用途は次の通りとする。

| 用途 | 内容 |
| --- | --- |
| 周期処理 | 一定周期での更新 |
| 時間を含む制御 | 経過時間を伴う動作 |
| センサ読み取り | ADC、IMU、ボタン、通信入力 |
| 状態遷移 | モード、フェーズ、安全停止の明示 |
| 状態推定 | フィルタ、推定器 |
| 制御出力 | PWM、モーター、サーボ |
| 小型表示 | OLED などへの描画 |
| 対話 | UART / USB serial による簡易操作 |

汎用言語は目指さない。狙いは、小さなシステムの振る舞いを、意味を保った値で読みやすく記述することにある。

## 2. 設計原則

| 原則 | 内容 |
| --- | --- |
| 値と作用の分離 | 値取得、永続値更新、外界作用を文法上分ける |
| 永続と一時の分離 | `var` と `temp` を分ける |
| 状態遷移の集約 | モード遷移は `state` 宣言に集める |
| 固定値の明示 | `const` により不変値を明示する |
| 意味単位の維持 | `%`、`deg`、`ms`、`dps` などを第一級で扱う |
| 時間モデルの可視化 | 周期、待機、イベント、状態経過時間を見やすくする |
| 所有関係の明示 | `var` や状態付き対象の更新責務を追いやすくする |
| interactive 性の補助 | 言語本体を変えず、実行環境で補助する |

## 3. 字句とブロック

StaticCore Script は中括弧によるブロックを基本とする。インデントは整形規約として重視するが、構文上の境界は中括弧で定まる。

| 項目 | 方針 |
| --- | --- |
| ブロック境界 | `{ ... }` |
| インデント | 推奨 |
| 単文省略 | 本版では導入しない |
| interactive 専用短縮構文 | 本版では導入しない |

## 4. 宣言

### 4.1 宣言一覧

| 宣言 | 意味 |
| --- | --- |
| `ref` | 外部対象への参照 |
| `const` | 不変の固定値 |
| `var` | 更新される永続値 |
| `state` | 階層状態機械 |
| `temp` | task 内の局所一時値 |
| `filter` | 状態付きフィルタ |
| `estimator` | 状態推定器 |
| `controller` | 制御器 |
| `animator` | 時間進行を持つ処理器 |
| `range` | 名前付き範囲 |
| `task` | 実行単位 |

### 4.2 値の役割分担

| 種類 | 更新可否 | 生存期間 | 用途 |
| --- | --- | --- | --- |
| `const` | 不可 | 実行中を通して不変 | 係数、寸法、閾値、固定設定 |
| `var` | 可 | 周期や待機をまたぐ | センサ値、出力目標、推定値 |
| `temp` | 不可 | task 実行中のみ | 計算途中の値 |
| `state` | 直接更新不可 | 実行中を通して保持 | モード、フェーズ、状態遷移 |

v0.4 まで `state name = expr` として表していた永続値は、v0.5 では `var name = expr` と書く。`state` は状態機械専用の宣言とする。

### 4.3 例

```text
ref led = pwm#0
const gravity = 1
var angle = 0deg
temp raw = read adc#0
filter avg = average size 8
controller pid0 = pid kp 32 ki 0.4 kd 1.8 clamp -100%..100%
```

## 5. デバイス参照と属性

### 5.1 デバイス参照

デバイス参照は `kind#id` 形式で表す。

```text
pwm#0
button#0
adc#0
imu#0
motor#0
display#0
servo#0
serial#0
```

### 5.2 属性参照

対象の属性や状態にはドット記法を用いる。

```text
imu0.gyro
sw.down
sw.pressed
host.line_ready
adc#0.pin
adc#0.range
rover.Avoid.elapsed
```

| 種類 | 例 |
| --- | --- |
| 観測値 | `read adc#0` |
| 状態属性 | `sw.down`, `host.line_ready` |
| 情報属性 | `adc#0.pin`, `adc#0.kind`, `adc#0.range` |
| 状態機械属性 | `rover.Avoid.elapsed` |

`read` は外界の観測値取得に用いる。状態機械属性は言語ランタイムが管理する読み取り専用値として参照する。

## 6. 基本操作

本言語の中心は、値取得・状態付き演算・永続値更新・作用・待機の分離にある。

| 構文 | 役割 |
| --- | --- |
| `read` | 外界から値を取得する |
| `step` | 状態付き処理を一歩進める |
| `set` | `var` を更新する |
| `do` | 外界へ作用する |
| `wait` | task を待機させる |

```text
temp raw = read adc#0
temp gyro = read imu0.gyro
set angle = step tilt with accel_angle gyro_rate dt
set power = step pid0 with target_angle - angle dt
do led.level(50%)
do screen.present()
do host.println("ready")
```

`set` の左辺に書けるのは `var` である。`state` の現在状態や `statePath.elapsed` は直接 `set` できない。

## 7. 実行モデル

### 7.1 基本

プログラムは静的に定義された `task` 群と `state` 群から構成される。各 task は cooperative に実行される。

### 7.2 task の種類

| 形式 | 意味 |
| --- | --- |
| `task name every duration { ... }` | 周期 task |
| `task name on event_expr { ... }` | イベント task |
| `task name loop { ... }` | 明示的な待機を含む loop task |
| `task name in statePath every duration { ... }` | 状態所属の周期 task |
| `task name in statePath on enter { ... }` | 状態 enter 時の task |
| `task name in statePath on exit { ... }` | 状態 exit 時の task |

状態所属 task の `in` は、単なる条件ではなく「この task はその状態に所属する」という宣言である。この所属情報は、状態排他性と `var` 書き込み規則の根拠になる。

### 7.3 task on の意味

`task name on event_expr { body }` は、意味上、次の構造と等価とみなす。

```text
task name loop {
  wait until event_expr
  body
}
```

task 本体の実行中に追加で発生した同一イベントは、再入せず、次回待機へ戻った後に評価される。本版ではイベントキューを持たない。

### 7.4 周期 task の規則

| 項目 | 方針 |
| --- | --- |
| 実行方式 | cooperative |
| 同一 tick の順序 | 宣言順 |
| `dt` | 周期 task 内の暗黙読み取り専用値 |
| overrun | 積み増さず、元の周期列に従う |

### 7.5 tick フェーズ

| フェーズ | 内容 |
| --- | --- |
| 1 | 入力状態とイベント更新 |
| 2 | `state` の遷移条件評価 |
| 3 | 必要な `on exit` / `on enter` task を実行 |
| 4 | `wait until` 条件評価 |
| 5 | 実行可能 task を宣言順に実行 |
| 6 | `do` の作用要求を反映 |

状態遷移は同一 tick で最大 1 回とする。遷移直後に遷移先の条件が成立していても、次の state tick まで追加遷移しない。

## 8. 状態機械

### 8.1 目的

`state` 宣言は、モードやフェーズの遷移を 1 箇所に集めるための宣言である。状態機械本体には処理を書かない。処理は `task ... in statePath ...` として外側に定義する。

これにより、状態遷移表と処理本体を分けたまま、task がどの状態に所属するかを静的に読める。

### 8.2 基本形

```text
state rover every 20ms initial rover.Idle {
  on emergency -> rover.Error

  Idle {
    on cmd == "manual" -> rover.Manual
    on cmd == "auto"   -> rover.AutoDrive
  }

  Manual initial rover.Manual.Stop {
    on cmd == "idle" -> rover.Idle

    Stop {}
    Forward {}
    Back {}
  }

  AutoDrive {
    on distance < obstacle_near -> rover.Avoid
  }

  Avoid {
    on rover.Avoid.elapsed >= recover_time -> rover.AutoDrive
  }

  Error {
    on cmd == "reset" -> rover.Idle
  }
}
```

### 8.3 状態機械本体に書けるもの

状態機械本体に書けるものは次に限る。

| 構文 | 意味 |
| --- | --- |
| `StateName { ... }` | 状態の宣言 |
| `StateName initial statePath { ... }` | 初期子状態を持つ状態の宣言 |
| `on condition -> statePath` | 遷移規則 |

`set`、`do`、`read`、`wait`、`temp`、`match` 文は状態機械本体には書けない。状態内の処理は必ず task として定義する。

### 8.4 状態パス

状態パスは状態機械名から始まる絶対パスで書く。

```text
rover.Idle
rover.Manual
rover.Manual.Forward
```

`initial` と遷移先は必ず絶対状態パスで書く。`../Idle` のような相対パスは本版では導入しない。絶対パスは冗長になりうるが、初期仕様では読みやすさと診断の明確さを優先する。

### 8.5 active 状態

状態機械は常に 1 つの leaf 状態を active とする。leaf 状態が active のとき、その祖先状態も active とみなす。

例えば `rover.Manual.Forward` が leaf として active のとき、次の状態は active である。

```text
rover.Manual
rover.Manual.Forward
```

この性質により、`task ... in rover.Manual ...` と `task ... in rover.Manual.Forward ...` は同時に動きうる。

### 8.6 遷移優先順位

遷移条件は次の順に評価する。

1. 状態機械直下の `on` を評価する
2. active leaf 状態の `on` を評価する
3. 親状態へ上がりながら `on` を評価する

状態機械直下の `on` は global transition として扱う。非常停止など、どの状態からでも優先したい遷移に用いる。

同じ場所に複数の `on` がある場合は宣言順に評価し、最初に成立した遷移だけを採用する。

### 8.7 enter / exit 順序

遷移時は、遷移元と遷移先の共通祖先を求める。

| 処理 | 順序 |
| --- | --- |
| `on exit` | 深い状態から浅い状態へ |
| active leaf 更新 | exit 後、enter 前 |
| `elapsed` リセット | enter 対象状態を `0ms` にする |
| `on enter` | 浅い状態から深い状態へ |

共通祖先は exit / enter しない。

例として `rover.Manual.Forward -> rover.Manual.Back` の場合、`rover.Manual` は exit / enter せず、`rover.Manual.Forward` の exit と `rover.Manual.Back` の enter だけが走る。

### 8.8 初期子状態

子状態を持つ状態へ遷移した場合、その状態の `initial` で指定した子状態へ入る。前回の子状態を復元する履歴状態は本版では導入しない。

```text
Manual initial rover.Manual.Stop {
  Stop {}
  Forward {}
}
```

`rover.Manual` へ遷移すると、active leaf は `rover.Manual.Stop` になる。

### 8.9 状態 elapsed

各状態パスは読み取り専用の `elapsed` 属性を持つ。

```text
rover.Avoid.elapsed
rover.Manual.elapsed
rover.Manual.Forward.elapsed
```

`statePath.elapsed` は、その状態へ enter してからの経過時間を表す時間値である。状態を exit して再 enter した場合、`elapsed` は再び `0ms` から始まる。履歴時間は保持しない。

`set rover.Avoid.elapsed = 0ms` のような書き込みは不可とする。

| 場面 | `elapsed` の見え方 |
| --- | --- |
| 遷移条件評価時 | tick 開始時点の経過時間 |
| enter した tick の `on enter` task | `0ms` |
| active 状態の周期 task | 現在 tick 時点の経過時間 |
| exit 後 | その状態の `elapsed` は参照対象として非 active |

時間経過だけを表す `var` は、可能な限り `statePath.elapsed` で置き換える。

### 8.10 状態所属 task

状態に紐づく処理は、状態機械本体ではなく外側の task として書く。

```text
task manual_forward in rover.Manual.Forward every 20ms {
  set left_power = cruise_speed
  set right_power = cruise_speed
}

task enter_auto in rover.AutoDrive on enter {
  set led_level = 70%
}

task stop_manual in rover.Manual on exit {
  set left_power = 0%
  set right_power = 0%
}
```

`in rover.Manual` は `rover.Manual` 配下にいる間 active である。子状態でも動くため、親状態 task は共通処理に限定し、leaf 状態固有の出力更新は leaf 状態 task へ寄せることを推奨する。

## 9. 所有規則

内部状態を持つ対象は single-writer / single-step に寄せる。

| 対象 | 規則 |
| --- | --- |
| `var` | 原則としてひとつの task のみ `set` 可 |
| `state` | 状態機械自身だけが active leaf を更新可 |
| `filter` | ひとつの task のみ `step` 可 |
| `estimator` | ひとつの task のみ `step` 可 |
| `controller` | ひとつの task のみ `step` 可 |
| `animator` | ひとつの task のみ `step` 可 |

参照のみは複数 task から許可する。

### 9.1 状態所属 task と `var` 書き込み

状態所属 task 同士が同じ `var` に書く場合、所属状態が同時に active になりえないことをコンパイラが証明できる場合だけ許可する。

許可例:

```text
task manual_forward in rover.Manual.Forward every 20ms {
  set left_power = cruise_speed
}

task manual_back in rover.Manual.Back every 20ms {
  set left_power = -cruise_speed
}
```

`rover.Manual.Forward` と `rover.Manual.Back` は同じ親を持つ別 leaf 状態であり、同時に active にならない。

禁止例:

```text
task manual_common in rover.Manual every 20ms {
  set left_power = 0%
}

task manual_forward in rover.Manual.Forward every 20ms {
  set left_power = cruise_speed
}
```

`rover.Manual.Forward` 中は `rover.Manual` も active であるため、同時 writer になりうる。

通常 task は全状態で動きうるため、状態所属 task と同じ `var` を書く場合は原則としてコンパイルエラーにする。

### 9.2 enter 初期化と周期更新

同じ状態に所属する `on enter` 初期化 task と `every` 更新 task が同じ `var` へ書くケースは実用上重要である。ただし、例外を広げすぎると所有規則が弱くなる。

本版では次の順で扱う。

1. 時間経過だけを表す値は `statePath.elapsed` で表し、手書き timer 用 `var` を作らない
2. それでも必要な場合に限り、同じ状態に所属する `on enter` と `every` の同一 `var` 書き込みを許可する
3. 許可する場合の実行順は `on enter` が先、`every` が後で固定する

優先順位で writer の勝者を決める方式は採用しない。結果を初見で追いにくくなるため、競合は静的エラーを基本にする。

## 10. 型と単位

### 10.1 組み込み値型

| 型 | 例 |
| --- | --- |
| 整数 | `0`, `42` |
| 真偽値 | `true`, `false` |
| 文字列 | `"hello"` |
| 割合値 | `50%` |
| 角度値 | `90deg` |
| 時間値 | `5ms`, `1s`, `rover.Avoid.elapsed` |
| 角速度値 | `0dps` |
| 加速度値 | `1g` |
| 範囲値 | `0..1023` |
| `vec2` | `vec2(10, 20)` |
| `vec3` | `vec3(0, 0, 1)` |

### 10.2 単位規則

| 規則 | 方針 |
| --- | --- |
| 単位不整合演算 | コンパイル時エラー |
| `0` | 初期値に限り無単位で許可 |
| `statePath.elapsed` | 時間値として扱う |
| `atan2` | `deg` を返す |
| `min` / `max` | 同一単位型のみ |
| `clamp` | 値と範囲の単位一致が必要 |

```text
angle + 10deg                  // 許可
power < 0%                     // 許可
rover.Avoid.elapsed >= 500ms   // 許可
angle + 10ms                   // 不許可
gyro.y - 1deg                  // 不許可
```

## 11. 比較と範囲

### 11.1 連鎖比較

連鎖比較は限定付きで許可する。

| 演算子 | 連鎖可否 |
| --- | --- |
| `<` | 可 |
| `<=` | 可 |
| `>` | 可 |
| `>=` | 可 |
| `==` | 不可 |
| `!=` | 不可 |

```text
if -20deg <= angle <= 20deg { ... }
if 100 < raw < 900 { ... }
```

### 11.2 範囲

範囲は `a..b` で表す。

```text
0..1023
0%..100%
-20deg..20deg
```

`match` における有界範囲 `a..b` は原則として左閉右開とする。

| 形式 | 意味 |
| --- | --- |
| `..b` | `x < b` |
| `a..` | `a <= x` |

## 12. match

`match` は値や範囲による分類を簡潔に記述するための構文である。

### 12.1 基本形

```text
match value {
  pattern => expr
  ...
  else => expr
}
```

### 12.2 パターン

| パターン | 意味 |
| --- | --- |
| リテラル | 完全一致 |
| 範囲 | 区間への包含判定 |
| 名前付き範囲 | `range` 宣言済み区間 |
| `else` | 上記以外 |

### 12.3 例

```text
temp led_level =
  match power {
    0%..20%   => 10%
    20%..40%  => 25%
    40%..60%  => 50%
    60%..80%  => 75%
    80%..100% => 100%
    else      => 0%
  }
```

```text
match cmd {
  "on" => {
    do led.level(100%)
  }
  "off" => {
    do led.level(0%)
  }
  else => {
    do host.println("ERR")
  }
}
```

## 13. 失敗しうる操作と else

`read` と `step` には回復句として `else` を付けられる。

| 形式 | 意味 |
| --- | --- |
| `read x` | 対象ごとの既定失敗動作 |
| `read x else value` | 代替値を使う |
| `read x else return` | 現在 task 実行を終了 |
| `step p with a` | 対象ごとの既定失敗動作 |
| `step p with a else value` | 代替値を使う |
| `step p with a else return` | 現在 task 実行を終了 |

```text
temp gyro = read imu0.gyro else return
temp raw = read adc#0 else 0
temp power = step pid0 with error dt else 0%
```

## 14. wait until

通信やイベントには `wait until` が有効である。

| 場面 | 記法 |
| --- | --- |
| ボタン押下待ち | `wait until sw.pressed` |
| 送信完了待ち | `wait until host.drained` |
| 1 行受信待ち | `wait until host.line_ready` |
| サーボ完了待ち | `wait until servo0.done` |

| 目的 | 向いた構文 |
| --- | --- |
| 成立まで待つ | `wait until ...` |
| 成立しなければ抜ける | `... else return` |

## 15. 状態付き処理器

### 15.1 宣言

```text
filter avg = average size 8
filter gy_f = ema alpha 0.2
estimator tilt = complementary alpha 0.98
controller pid0 = pid kp 32 ki 0.4 kd 1.8 clamp -100%..100%
```

### 15.2 step

```text
temp smooth = step avg with raw
set angle = step tilt with accel_angle gyro_rate dt
set power = step pid0 with error dt
```

### 15.3 時間進行を持つ処理

時間進行を伴う高水準処理も処理器として扱う。

```text
var led_level = 0%
animator up = ramp to 100% over 1200ms ease ease_in_out
animator down = ramp to 0% over 1200ms ease ease_in_out
set led_level = step up with dt
do led.level(led_level)
```

## 16. 通信デバイス

### 16.1 I2C / SPI

I2C や SPI は、通常は意味デバイスの内部実装に置く。利用者は `imu0.gyro` や `screen.present()` を用いる。

### 16.2 UART / USB serial

UART / USB serial は、利用者が直接扱う通信デバイスとして表面へ出す。

| 状態 | 意味 |
| --- | --- |
| `connected` | 接続済み |
| `readable` | 読み取り可能データあり |
| `line_ready` | 1 行成立 |
| `packet_ready` | 1 パケット成立 |
| `writable` | 送信可能 |
| `drained` | 送信完了 |
| `fault` | 通信異常 |
| `overflow` | バッファあふれ |

## 17. 作用 API の同期境界

`do` は要求受理を意味し、物理完了までは保証しない。

| 項目 | 方針 |
| --- | --- |
| `do` 完了 | 要求が受理された |
| 物理完了 | `.done` や `drained` で観測 |
| 描画 | `present()` まで蓄積し、`present()` で確定 |

```text
do servo0.angle(90deg)
wait until servo0.done
```

## 18. interactive 利用

interactive 利用は、別文法や別モードではなく、同じ文法に対する実行環境側の補助として扱う。言語本体の意味は変えない。

### 18.1 単独式の自動 echo

対話環境では、単独で評価した式の結果を既定表示してよい。

| 入力 | 表示例 |
| --- | --- |
| `read adc#0` | `adc#0 = 713` |
| `adc#0.pin` | `adc#0.pin = A0` |
| `read imu#0.gyro.y` | `imu#0.gyro.y = 2dps` |
| `rover.Avoid.elapsed` | `rover.Avoid.elapsed = 320ms` |

### 18.2 info

対話環境では、一覧や要約表示を用意してよい。

```text
> adc#0.info
kind: adc
id: 0
pin: A0
range: 0..1023
resolution: 10
```

### 18.3 方針

| 項目 | 方針 |
| --- | --- |
| モード切り替え | 持たない |
| 文法 | 常に同一 |
| interactive 性 | 結果表示と補助機能で実現 |
| `read` の意味 | 常に同じ |
| 属性参照 | 常に同じ |

## 19. interactive な対象選択

通常スクリプトは静的束縛を基本にする。対話利用では `bind` のような実行環境操作を持ってよい。

| 場面 | 方針 |
| --- | --- |
| 通常スクリプト | `ref knob = adc#0` |
| 対話利用 | `bind probe = adc#3` のような実行環境操作 |
| 限定的動的参照 | 必要なら `adc[index]` のような kind 付き動的参照 |

## 20. interactive task registration

interactive 利用では、その場で task を定義・登録・制御できるようにしてよい。用いる構文は言語本体の task と同一とする。

| コマンド | 用途 |
| --- | --- |
| `list tasks` | 全 task 一覧 |
| `list tasks on target` | 対象ごとの一覧 |
| `show task_name` | 詳細表示 |
| `stop task_name` | 停止 |
| `start task_name` | 再開 |
| `drop task_name` | 削除 |
| `drop tasks on target` | 対象関連 task を一括削除 |

```text
> task pulse on button#0.pressed {
    do pwm#0.level(100%)
    wait 50ms
    do pwm#0.level(0%)
  }
> list tasks
pulse       running   on button#0.pressed
```

## 21. サンプル

### 21.1 UART コマンド

```text
// 責務: UART文字列コマンドを受け取り、LED操作へ変換する。

ref host = serial#0
ref led  = pwm#0

task shell on host.line_ready {
  temp cmd = read host.line
  match cmd {
    "on" => {
      do led.level(100%)
      do host.println("LED ON")
    }
    "off" => {
      do led.level(0%)
      do host.println("LED OFF")
    }
    else => {
      do host.println("ERR")
    }
  }
}
```

### 21.2 ボタン押下でパルス

```text
// 責務: ボタン押下イベントに応じてLEDを短時間だけ点灯する。

ref sw  = button#0
ref led = pwm#0

const pulse_duration = 80ms

task pulse on sw.pressed {
  do led.level(100%)
  wait pulse_duration
  do led.level(0%)
}
```

### 21.3 IMU + 推定 + PID + モーター

```text
// 責務: IMU姿勢推定とPID制御により単一モーター出力を更新する。

ref imu0   = imu#0
ref motor0 = motor#0

filter gy_f = ema alpha 0.2
estimator tilt = complementary alpha 0.98
controller pid0 = pid kp 32 ki 0.4 kd 1.8 clamp -100%..100%

var gyro_bias = 0dps
var target_angle = 0deg
var angle = 0deg
var power = 0%

task balance every 5ms {
  temp accel = read imu0.accel else return
  temp gyro  = read imu0.gyro else return
  temp accel_angle = atan2(accel.x, accel.z)
  temp gyro_rate = step gy_f with gyro.y - gyro_bias
  set angle = step tilt with accel_angle gyro_rate dt
  set power = step pid0 with target_angle - angle dt
  do motor0.drive(power)
}
```

### 21.4 OLED にボールのバウンドを描く

```text
// 責務: 画面内を跳ねるボールの位置更新と描画を行う。

ref screen = display#0

const left_x    = 4
const right_x   = 123
const ceiling_y = 4
const floor_y   = 56
const radius    = 3
const gravity   = 1
const bounce    = 80%

var x  = 16
var y  = 8
var vx = 2
var vy = 0

task bounce every 20ms {
  temp vx1 = vx
  temp vy1 = vy + gravity
  temp x1 = x + vx1
  temp y1 = y + vy1
  temp next_x =
    match x1 {
      ..left_x        => left_x
      left_x..right_x => x1
      right_x..       => right_x
    }
  temp next_vx =
    match x1 {
      ..left_x        => -vx1
      left_x..right_x => vx1
      right_x..       => -vx1
    }
  temp next_y =
    match y1 {
      ..ceiling_y         => ceiling_y
      ceiling_y..floor_y  => y1
      floor_y..           => floor_y
    }
  temp next_vy =
    match y1 {
      ..ceiling_y         => 0
      ceiling_y..floor_y  => vy1
      floor_y..           => -(vy1 * bounce / 100%)
    }
  set x  = next_x
  set vx = next_vx
  set y  = next_y
  set vy = next_vy
  do screen.clear()
  do screen.circle(x, y, radius)
  do screen.line(0, floor_y + radius, 127, floor_y + radius)
  do screen.present()
}
```

### 21.5 状態機械によるローバー制御

```text
// 責務: ローバーの入力、状態遷移、状態別駆動、出力反映を分離する。

ref host  = serial#0
ref sonar = adc#0
ref left  = motor#0
ref right = motor#1
ref led   = pwm#0

const obstacle_near = 300
const cruise_speed  = 40%
const turn_power    = 30%
const recover_time  = 500ms

var cmd = "none"
var distance = 0

var left_power  = 0%
var right_power = 0%
var led_level   = 0%
var emergency = false

task input on host.line_ready {
  set cmd = read host.line
}

task sense every 50ms {
  set distance = read sonar else return
}

state rover every 20ms initial rover.Idle {
  on emergency -> rover.Error

  Idle {
    on cmd == "manual" -> rover.Manual
    on cmd == "auto"   -> rover.AutoDrive
  }

  Manual initial rover.Manual.Stop {
    on cmd == "idle" -> rover.Idle
    on cmd == "auto" -> rover.AutoDrive

    Stop {
      on cmd == "forward" -> rover.Manual.Forward
      on cmd == "back"    -> rover.Manual.Back
      on cmd == "left"    -> rover.Manual.TurnLeft
      on cmd == "right"   -> rover.Manual.TurnRight
    }

    Forward {
      on cmd == "stop" -> rover.Manual.Stop
    }

    Back {
      on cmd == "stop" -> rover.Manual.Stop
    }

    TurnLeft {
      on cmd == "stop" -> rover.Manual.Stop
    }

    TurnRight {
      on cmd == "stop" -> rover.Manual.Stop
    }
  }

  AutoDrive {
    on cmd == "idle"            -> rover.Idle
    on cmd == "manual"          -> rover.Manual
    on distance < obstacle_near -> rover.Avoid
  }

  Avoid {
    on cmd == "idle"                       -> rover.Idle
    on cmd == "manual"                     -> rover.Manual
    on rover.Avoid.elapsed >= recover_time -> rover.AutoDrive
  }

  Error {
    on cmd == "reset" -> rover.Idle
  }
}

task enter_idle in rover.Idle on enter {
  set left_power = 0%
  set right_power = 0%
  set led_level = 10%
  set cmd = "none"
}

task enter_manual in rover.Manual on enter {
  set led_level = 40%
}

task enter_auto in rover.AutoDrive on enter {
  set led_level = 70%
}

task enter_avoid in rover.Avoid on enter {
  set led_level = 100%
}

task enter_error in rover.Error on enter {
  set left_power = 0%
  set right_power = 0%
  set led_level = 100%
}

task manual_stop in rover.Manual.Stop every 20ms {
  set left_power = 0%
  set right_power = 0%
}

task manual_forward in rover.Manual.Forward every 20ms {
  set left_power = cruise_speed
  set right_power = cruise_speed
}

task manual_back in rover.Manual.Back every 20ms {
  set left_power = -cruise_speed
  set right_power = -cruise_speed
}

task manual_left in rover.Manual.TurnLeft every 20ms {
  set left_power = -turn_power
  set right_power = turn_power
}

task manual_right in rover.Manual.TurnRight every 20ms {
  set left_power = turn_power
  set right_power = -turn_power
}

task autodrive in rover.AutoDrive every 50ms {
  set left_power = cruise_speed
  set right_power = cruise_speed
}

task avoid in rover.Avoid every 20ms {
  set left_power = -turn_power
  set right_power = turn_power
}

task stop_manual in rover.Manual on exit {
  set left_power = 0%
  set right_power = 0%
}

task stop_auto in rover.AutoDrive on exit {
  set left_power = 0%
  set right_power = 0%
}

task stop_avoid in rover.Avoid on exit {
  set left_power = 0%
  set right_power = 0%
}

task output every 20ms {
  do left.drive(left_power)
  do right.drive(right_power)
  do led.level(led_level)
}
```

この例では `recover_timer` を持たず、`rover.Avoid.elapsed` で復帰条件を書く。状態機械本体は遷移だけを持ち、状態ごとの作用は状態所属 task に分離する。

## 22. 非目標

| 項目 | 本版の扱い |
| --- | --- |
| 動的メモリ管理 | 含まない |
| 例外 | 含まない |
| 汎用クラス定義 | 含まない |
| 汎用オブジェクトシステム | 含まない |
| RTTI | 含まない |
| 複雑な型推論 | 含まない |
| 大規模標準ライブラリ | 含まない |
| 高機能 GUI | 含まない |
| 行列演算全般 | 含まない |
| 状態機械内の処理文 | 含まない |
| 相対状態パス | 含まない |
| 状態履歴復元 | 含まない |

## 23. 今後の検討項目

| 項目 | 検討内容 |
| --- | --- |
| 複数値返却 | `match` による次状態選択をさらに簡潔にする |
| event 型 | 真偽値から独立概念へ拡張するか検討する |
| enum / symbol | 文字列コマンド typo をコンパイル時に拾う |
| 汎用 timer | 明示的な reset を持つ stopwatch 型を導入するか検討する |
| 状態パス alias | 絶対状態パスが長い場合の省略方法を検討する |
| 固定長配列 | `name[index]` と fixed-size buffer の導入 |
| 数値内部表現 | fixed-point 方針の明文化 |
| packet / frame API | 通信構造体の標準化 |
| fault / stale / timeout | 異常状態語彙の標準化 |
| interactive 補完 | help、候補表示、補完の整備 |

## 24. 仕様の芯

StaticCore Script の骨格は次の通りである。

1. `read` / `step` / `set` / `do` / `wait` の分離を維持する
2. `const` により固定値を `var` から分ける
3. `var` により周期や待機をまたぐ永続値を表す
4. `state` により状態遷移を 1 箇所へ集約する
5. 状態機械本体には処理を書かず、処理は `task ... in statePath ...` に分離する
6. `statePath.elapsed` により状態経過時間を読み取り専用で扱う
7. `match` により分類と次状態選択を簡潔にする
8. `else` を `read` と `step` の回復句として導入する
9. 通信は `wait until` と `match` の組み合わせで扱う
10. `task on event` を導入し、イベント駆動を task モデルへ統合する
11. `var` 書き込み競合は優先順位で隠さず、状態排他性で静的に扱う
12. interactive 利用では、自動 echo、info、task registry を実行環境側へ置く
13. モード切り替えは持たず、言語本体の意味を一貫させる
