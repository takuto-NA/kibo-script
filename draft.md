StaticCore Script v0.4-draft

Language Specification

1. 目的

StaticCore Script は、小型デバイス向けの bounded かつ inspectable な制御スクリプト言語である。対象は LED、PWM、ボタン、ADC、IMU、サーボ、モーター、OLED、UART / USB serial を中心とする。

主用途は次の通りとする。

用途	内容
周期処理	一定周期での更新
時間を含む制御	経過時間を伴う動作
センサ読み取り	ADC、IMU、ボタン、通信入力
状態推定	フィルタ、推定器
制御出力	PWM、モーター、サーボ
小型表示	OLED などへの描画
対話	UART / USB serial による簡易操作

汎用言語は目指さない。狙いは、小さなシステムの振る舞いを、意味を保った値で読みやすく記述することにある。

⸻

2. 設計原則

原則	内容
値と作用の分離	値取得、状態更新、外界作用を文法上分ける
永続と一時の分離	state と temp を分ける
固定値の明示	const により不変値を明示する
意味単位の維持	% deg ms dps などを第一級で扱う
時間モデルの可視化	周期、待機、イベント起動を見やすくする
所有関係の明示	状態付き対象の更新責務を追いやすくする
interactive 性の補助	言語本体を変えず、実行環境で補助する

⸻

3. 字句とブロック

StaticCore Script は中括弧によるブロックを基本とする。インデントは整形規約として重視するが、構文上の境界は中括弧で定まる。

3.1 ブロック方針

項目	方針
ブロック境界	{ ... }
インデント	推奨
単文省略	本版では導入しない
interactive 専用短縮構文	本版では導入しない

⸻

4. 宣言

4.1 宣言一覧

宣言	意味
ref	外部対象への参照
const	不変の固定値
state	更新される永続値
temp	局所一時値
filter	状態付きフィルタ
estimator	状態推定器
controller	制御器
animator	時間進行を持つ処理器
range	名前付き範囲
task	実行単位

4.2 値の役割分担

種類	更新可否	生存期間	用途
const	不可	実行中を通して不変	係数、寸法、閾値、固定設定
state	可	周期や待機をまたぐ	制御状態、位置、速度、モード
temp	不可	文脈内のみ	計算途中の値

4.3 例

ref led = pwm#0
const gravity = 1
state angle = 0deg
temp raw = read adc#0
filter avg = average size 8
controller pid0 = pid kp 32 ki 0.4 kd 1.8 clamp -100%..100%

⸻

5. デバイス参照と属性

5.1 デバイス参照

デバイス参照は kind#id 形式で表す。

pwm#0
button#0
adc#0
imu#0
motor#0
display#0
servo#0
serial#0

5.2 属性参照

対象の属性や状態にはドット記法を用いる。

imu0.gyro
sw.down
sw.pressed
host.line_ready
adc#0.pin
adc#0.range

5.3 原則

read は観測値の取得に用いる。
属性参照はドット記法に寄せる。

種類	例
観測値	read adc#0
状態属性	sw.down, host.line_ready
情報属性	adc#0.pin, adc#0.kind, adc#0.range

⸻

6. 基本操作

本言語の中心は、値取得・状態付き演算・状態更新・作用・待機の分離にある。

構文	役割
read	外界から値を取得する
step	状態付き処理を一歩進める
set	state を更新する
do	外界へ作用する
wait	task を待機させる

6.1 例

temp raw = read adc#0
temp gyro = read imu0.gyro
set angle = step tilt with accel_angle gyro_rate dt
set power = step pid0 with target_angle - angle dt
do led.level(50%)
do screen.present()
do host.println("ready")

⸻

7. 実行モデル

7.1 基本

プログラムは静的に定義された task 群から構成される。各 task は cooperative に実行される。

7.2 task の種類

形式	意味
task name { ... }	通常 task。登録時に実行可能となる
task name every duration { ... }	周期 task
task name on event_expr { ... }	イベント task

7.3 task on の意味

task name on event_expr { body } は、意味上、次の構造と等価とみなす。

task name {
  loop {
    wait until event_expr
    body
  }
}

task 本体の実行中に追加で発生した同一イベントは、再入せず、次回待機へ戻った後に評価される。
本版ではイベントキューを持たない。

7.4 周期 task の規則

項目	方針
実行方式	cooperative
同一 tick の順序	宣言順
dt	周期 task 内の暗黙読み取り専用値
overrun	積み増さず、元の周期列に従う

7.5 tick フェーズ

フェーズ	内容
1	入力状態とイベント更新
2	wait until 条件評価
3	実行可能 task を宣言順に実行
4	do の作用要求を反映

⸻

8. 所有規則

内部状態を持つ対象は single-writer / single-step に寄せる。

対象	規則
state	ひとつの task のみ set 可
filter	ひとつの task のみ step 可
estimator	ひとつの task のみ step 可
controller	ひとつの task のみ step 可
animator	ひとつの task のみ step 可

参照のみは複数 task から許可する。

⸻

9. 型と単位

9.1 組み込み値型

型	例
整数	0, 42
真偽値	true, false
文字列	"hello"
割合値	50%
角度値	90deg
時間値	5ms, 1s
角速度値	0dps
加速度値	1g
範囲値	0..1023
vec2	vec2(10, 20)
vec3	vec3(0, 0, 1)

9.2 単位規則

規則	方針
単位不整合演算	コンパイル時エラー
0	初期値に限り無単位で許可
atan2	deg を返す
min / max	同一単位型のみ
clamp	値と範囲の単位一致が必要

9.3 例

式	判定
angle + 10deg	許可
power < 0%	許可
angle + 10ms	不許可
gyro.y - 1deg	不許可

⸻

10. 比較と範囲

10.1 連鎖比較

連鎖比較は限定付きで許可する。

演算子	連鎖可否
<	可
<=	可
>	可
>=	可
==	不可
!=	不可

10.2 例

if -20deg <= angle <= 20deg { ... }
if 100 < raw < 900 { ... }

10.3 範囲

範囲は a..b で表す。

0..1023
0%..100%
-20deg..20deg

10.4 区間規則

match における有界範囲 a..b は原則として左閉右開とする。
開放端範囲は次の意味を持つ。

形式	意味
..b	x < b
a..	a <= x

⸻

11. match

match は値や範囲による分類を簡潔に記述するための構文である。

11.1 用途

用途	例
文字列コマンドの分類	UART / USB serial
数値帯域の分類	LED 段階化、表示ラベル
次状態の選択	ボールの反射、モード遷移

11.2 基本形

match value {
  pattern => expr
  ...
  else => expr
}

11.3 パターン

パターン	意味
リテラル	完全一致
範囲	区間への包含判定
名前付き範囲	range 宣言済み区間
else	上記以外

11.4 例: 段階化

temp led_level =
  match power {
    0%..20%   => 10%
    20%..40%  => 25%
    40%..60%  => 50%
    60%..80%  => 75%
    80%..100% => 100%
    else      => 0%
  }

11.5 例: コマンド分類

match cmd {
  "on"  => { do led.level(100%) }
  "off" => { do led.level(0%) }
  else  => { do host.println("ERR") }
}

11.6 例: 次状態選択

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

⸻

12. 失敗しうる操作と else

read と step には回復句として else を付けられる。

12.1 形式

形式	意味
read x	対象ごとの既定失敗動作
read x else value	代替値を使う
read x else return	現在 task 実行を終了
step p with a	対象ごとの既定失敗動作
step p with a else value	代替値を使う
step p with a else return	現在 task 実行を終了

12.2 規則

項目	方針
else の対象	まず read と step に限定
else value	成功時の結果型と一致が必要
else return	現在 tick における task 実行終了
省略	可能。既定失敗動作を採用

12.3 例

temp gyro = read imu0.gyro else return
temp raw = read adc#0 else 0
temp power = step pid0 with error dt else 0%

⸻

13. wait until

通信やイベントには wait until が有効である。

13.1 用途

場面	記法
ボタン押下待ち	wait until sw.pressed
送信完了待ち	wait until host.drained
1 行受信待ち	wait until host.line_ready
サーボ完了待ち	wait until servo0.done

13.2 使い分け

目的	向いた構文
成立まで待つ	wait until ...
成立しなければ抜ける	... else return

⸻

14. 状態付き処理器

14.1 宣言

filter avg = average size 8
filter gy_f = ema alpha 0.2
estimator tilt = complementary alpha 0.98
controller pid0 = pid kp 32 ki 0.4 kd 1.8 clamp -100%..100%

14.2 step

temp smooth = step avg with raw
set angle = step tilt with accel_angle gyro_rate dt
set power = step pid0 with error dt

14.3 時間進行を持つ処理

時間進行を伴う高水準処理も処理器として扱う。

state led_level = 0%
animator up = ramp to 100% over 1200ms ease ease_in_out
animator down = ramp to 0% over 1200ms ease ease_in_out
set led_level = step up with dt
do led.level(led_level)

⸻

15. 通信デバイス

15.1 I2C / SPI

I2C や SPI は、通常は意味デバイスの内部実装に置く。利用者は imu0.gyro や screen.present() を用いる。

15.2 UART / USB serial

UART / USB serial は、利用者が直接扱う通信デバイスとして表面へ出す。

15.3 serial の状態

状態	意味
connected	接続済み
readable	読み取り可能データあり
line_ready	1 行成立
packet_ready	1 パケット成立
writable	送信可能
drained	送信完了
fault	通信異常
overflow	バッファあふれ

⸻

16. 作用 API の同期境界

do は要求受理を意味し、物理完了までは保証しない。

項目	方針
do 完了	要求が受理された
物理完了	.done や drained で観測
描画	present() まで蓄積し、present() で確定

16.1 例

do servo0.angle(90deg)
wait until servo0.done

⸻

17. interactive 利用

interactive 利用は、別文法や別モードではなく、同じ文法に対する実行環境側の補助として扱う。言語本体の意味は変えない。

17.1 単独式の自動 echo

対話環境では、単独で評価した式の結果を既定表示してよい。

入力	表示例
read adc#0	adc#0 = 713
adc#0.pin	adc#0.pin = A0
read imu#0.gyro.y	imu#0.gyro.y = 2dps

17.2 info

対話環境では、一覧や要約表示を用意してよい。

入力	例
adc#0.info	単体対象の要約
adc.info	利用可能 ADC 一覧

17.3 例

> read adc#0
adc#0 = 713
> adc#0.pin
adc#0.pin = A0
> adc#0.info
kind: adc
id: 0
pin: A0
range: 0..1023
resolution: 10

17.4 方針

項目	方針
モード切り替え	持たない
文法	常に同一
interactive 性	結果表示と補助機能で実現
read の意味	常に同じ
属性参照	常に同じ

⸻

18. interactive な対象選択

通常スクリプトは静的束縛を基本にする。対話利用では bind のような実行環境操作を持ってよい。

18.1 推奨構造

場面	方針
通常スクリプト	ref knob = adc#0
対話利用	bind probe = adc#3 のような実行環境操作
限定的動的参照	必要なら adc[index] のような kind 付き動的参照

18.2 理由

観点	静的束縛	完全動的指定
inspectable	高い	下がる
型安全	高い	崩れやすい
対象意味の明確さ	高い	曖昧になりやすい

⸻

19. interactive task registration

interactive 利用では、その場で task を定義・登録・制御できるようにしてよい。用いる構文は言語本体の task と同一とする。

19.1 目的

機能	内容
定義	その場で task を書ける
登録	即時に有効化できる
制御	start / stop / drop ができる
観察	状態や関連対象を見られる

19.2 例

> task pulse on button#0.pressed {
    do pwm#0.level(100%)
    wait 50ms
    do pwm#0.level(0%)
  }
> task monitor every 100ms {
    do serial#0.println(read adc#0)
  }

19.3 task registry

interactive 環境は task registry を持つ。task は追加可能であり、後から一覧・停止・削除できる。

コマンド	用途
list tasks	全 task 一覧
list tasks on target	対象ごとの一覧
show task_name	詳細表示
stop task_name	停止
start task_name	再開
drop task_name	削除
drop tasks on target	対象関連 task を一括削除

19.4 例

> list tasks
pulse       running   on button#0.pressed
monitor     running   every 100ms
> list tasks on button#0
pulse       running   on button#0.pressed
> drop task pulse
ok

⸻

20. サンプル

20.1 UART コマンド

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

20.2 ボタン押下でパルス

ref sw  = button#0
ref led = pwm#0
task pulse on sw.pressed {
  do led.level(100%)
  wait 80ms
  do led.level(0%)
}

20.3 IMU + 推定 + PID + モーター

ref imu0   = imu#0
ref motor0 = motor#0
filter gy_f = ema alpha 0.2
estimator tilt = complementary alpha 0.98
controller pid0 = pid kp 32 ki 0.4 kd 1.8 clamp -100%..100%
state gyro_bias = 0dps
state target_angle = 0deg
state angle = 0deg
state power = 0%
task balance every 5ms {
  temp accel = read imu0.accel else return
  temp gyro  = read imu0.gyro else return
  temp accel_angle = atan2(accel.x, accel.z)
  temp gyro_rate = step gy_f with gyro.y - gyro_bias
  set angle = step tilt with accel_angle gyro_rate dt
  set power = step pid0 with target_angle - angle dt
  do motor0.drive(power)
}

20.4 OLED にボールのバウンドを描く

ref screen = display#0
const left_x    = 4
const right_x   = 123
const ceiling_y = 4
const floor_y   = 56
const radius    = 3
const gravity   = 1
const bounce    = 80%
state x  = 16
state y  = 8
state vx = 2
state vy = 0
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

⸻

21. 非目標

項目	本版の扱い
動的メモリ管理	含まない
例外	含まない
汎用クラス定義	含まない
汎用オブジェクトシステム	含まない
RTTI	含まない
複雑な型推論	含まない
大規模標準ライブラリ	含まない
高機能 GUI	含まない
行列演算全般	含まない

⸻

22. 今後の検討項目

項目	検討内容
複数値返却	match による次状態選択をさらに簡潔にする
event 型	真偽値から独立概念へ拡張するか検討する
固定長配列	name[index] と fixed-size buffer の導入
数値内部表現	fixed-point 方針の明文化
packet / frame API	通信構造体の標準化
fault / stale / timeout	異常状態語彙の標準化
interactive 補完	help、候補表示、補完の整備

⸻

23. 仕様の芯

StaticCore Script の骨格は次の通りである。

1. read / step / set / do / wait の分離を維持する
2. const により固定値を state から分ける
3. match により分類と次状態選択を簡潔にする
4. else を read と step の回復句として導入する
5. 通信は wait until と match の組み合わせで扱う
6. task on event を導入し、イベント駆動を task モデルへ統合する
7. interactive 利用では、自動 echo、info、task registry を実行環境側へ置く
8. モード切り替えは持たず、言語本体の意味を一貫させる
