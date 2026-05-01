ref led = pwm#0
var led_target = 0%
var led_level = 0%

animator f = ramp over 100ms ease linear

task apply every 16ms {
  set led_level = step missing_anim with led_target dt
}
