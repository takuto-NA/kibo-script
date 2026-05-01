ref led = pwm#0
var led_target = 0%
var led_level = 0%

animator fade = ramp over 500ms ease linear

task apply every 16ms {
  set led_level = step fade with led_target dt
  do led.level(led_level)
}
