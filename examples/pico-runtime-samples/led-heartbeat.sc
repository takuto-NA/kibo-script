// 責務: Pico の onboard LED を 500ms ごとに toggle し、simulator / Pico trace の `led0` 一致を確認する。

ref status_led = led#0

task heartbeat every 500ms {
  do status_led.toggle()
}
