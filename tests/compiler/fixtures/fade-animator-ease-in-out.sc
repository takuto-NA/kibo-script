ref led = pwm#0
state led_level = 0%
animator fade_in = ramp from 0% to 100% over 500ms ease ease_in_out

task fade every 50ms {
  set led_level = step fade_in with dt
  do led.level(led_level)
}
