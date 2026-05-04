// 責務: `every` タスク内の `wait` と `waited_count` の更新順を conformance trace で確定する。

ref status_led = led#0
var waited_count = 0

task wait_skew every 200ms {
  do status_led.on()
  wait 50ms
  do status_led.off()
  set waited_count = waited_count + 1
}
