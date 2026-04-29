// 責務: task loop と wait 式だけで、最小の物理ローバー巡回を示すサンプル。

ref left_motor = motor#0
ref right_motor = motor#1
ref status_led = led#0

const forward_power_percent = 100
const turn_left_power_percent = -50
const turn_right_power_percent = 50

const forward_duration_ms = 2000
const turn_duration_ms = 1000

task simple_patrol loop {
  do status_led.off()
  do left_motor.power(forward_power_percent)
  do right_motor.power(forward_power_percent)
  wait forward_duration_ms ms

  do status_led.on()
  do left_motor.power(-100)
  do right_motor.power(-100)
  wait 1000 ms

  do status_led.on()
  do left_motor.power(turn_left_power_percent)
  do right_motor.power(turn_right_power_percent)
  wait turn_duration_ms ms
}
