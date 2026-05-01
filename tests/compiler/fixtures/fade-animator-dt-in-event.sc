ref b = button#0
var led_level = 0
animator f = ramp from 0% to 100% over 100ms ease linear
task handle on b.pressed {
  set led_level = step f with dt
}
