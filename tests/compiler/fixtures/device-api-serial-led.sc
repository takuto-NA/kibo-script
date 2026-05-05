// Fixture: serial#0.println は現状 Pico / C++ host で trace に影響しない no-op。

ref status_led = led#0
ref port = serial#0

task tick every 100ms {
  do port.println("x")
  do status_led.toggle()
}
