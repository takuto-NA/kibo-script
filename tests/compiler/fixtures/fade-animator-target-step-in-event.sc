ref b = button#0
var led_target = 50%
var led_level = 0%

animator f = ramp over 100ms ease linear

task handle on b.pressed {
  set led_level = step f with led_target dt
}
