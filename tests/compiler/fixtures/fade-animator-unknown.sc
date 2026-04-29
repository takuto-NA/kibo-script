ref led = pwm#0
state led_level = 0
animator f = ramp from 0% to 100% over 100ms ease linear
task t every 100ms {
  set led_level = step no_such_animator with dt
}
