// 責務: `button#0`（Pico 物理 PIN24 / GP18）押下で LED を toggle し、replay trace と実機入力の一致を確認する。

ref status_led = led#0

task toggle_status_led on button#0.pressed {
  do status_led.toggle()
}
