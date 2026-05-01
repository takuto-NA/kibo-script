ref led = pwm#0
var bad = "x"
var led_level = 0%

animator f = ramp over 100ms ease linear

task apply every 16ms {
  set led_level = step f with bad dt
}
