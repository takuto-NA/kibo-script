// 責務: 1 回の周期タスク内で LED の前半/後半状態を作り、wait 後の状態更新を trace する。

ref status_led = led#0
var beacon_cycles = 0
var beacon_phase = "start"

task waited_beacon every 240ms {
  set beacon_phase = "pulse"
  do status_led.on()
  do display#0.clear()
  do display#0.text(0, 0, "PULSE")
  do display#0.circle(32, 32, 5)
  do display#0.present()

  wait 80ms

  set beacon_phase = "rest"
  do status_led.off()
  do display#0.clear()
  do display#0.text(0, 0, "REST")
  do display#0.circle(96, 32, 5)
  do display#0.present()
  set beacon_cycles = beacon_cycles + 1
}
