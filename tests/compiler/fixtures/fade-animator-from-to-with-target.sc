ref led = pwm#0
var t = 50%
var led_level = 0%

animator f = ramp from 0% to 100% over 100ms ease linear

task apply every 16ms {
  set led_level = step f with t dt
}
