// 責務: replay で button#0.pressed を 2 回 dispatch し、LED toggle の trace 一致を確認する。

ref status_led = led#0

task toggle_status_led on button#0.pressed {
  do status_led.toggle()
}
