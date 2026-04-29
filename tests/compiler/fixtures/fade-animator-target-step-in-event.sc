ref b = button#0
state led_target = 50%
state led_level = 0%

animator f = ramp over 100ms ease linear

task handle on b.pressed {
  set led_level = step f with led_target dt
}
