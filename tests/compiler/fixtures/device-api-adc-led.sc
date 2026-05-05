// Fixture: adc#0.raw 既定 512（シミュレーター / C++ host 整合）。閾値で LED を固定オン。

ref status_led = led#0

task tick every 100ms {
  temp v = read adc#0
  if v > 400 {
    do status_led.on()
  } else {
    do status_led.off()
  }
}
