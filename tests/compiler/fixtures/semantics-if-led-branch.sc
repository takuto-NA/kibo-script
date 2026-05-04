// 責務: runtime conformance 用の最小 `if` 分岐（整数 truthy）で LED を切り替える。

ref status_led = led#0
var branch_toggle = 0

task if_led_branch every 100ms {
  if branch_toggle == 0 {
    do status_led.on()
    set branch_toggle = 1
  } else {
    do status_led.off()
    set branch_toggle = 0
  }
}
