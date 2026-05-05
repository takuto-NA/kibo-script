// Fixture: pwm#0.level は現状 Pico では no-op（C++ host も trace のみ）。LED で観測可能な変化を残す。

ref status_led = led#0

task tick every 100ms {
  do pwm#0.level(50)
  do status_led.toggle()
}
