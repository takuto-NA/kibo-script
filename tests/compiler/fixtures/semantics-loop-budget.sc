// 責務: `task ... loop` と `wait` の最小パターンを conformance trace で確定する。

ref status_led = led#0

task pulse_loop loop {
  do status_led.toggle()
  wait 1000ms
}
