// 責務: 永続 loop タスクで短いパルス列を作り、待ち時間を挟む処理を最小限の状態で見せる。

ref status_led = led#0
var pulse_count = 0

task pulse_train loop {
  do status_led.on()
  wait 60ms
  do status_led.off()
  wait 140ms
  set pulse_count = pulse_count + 1
}
