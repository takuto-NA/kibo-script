// Fixture: motor / servo は現状 no-op。LED toggle で trace を固定。

ref status_led = led#0

task tick every 100ms {
  do motor#0.power(10)
  do servo#0.angle(90)
  do status_led.toggle()
}
