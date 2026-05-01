ref led = pwm#0
var led_level = 0%
animator fade_in = ramp from 0% to 100% over 1000ms ease linear

task fade every 100ms {
  set led_level = step fade_in with dt
  do led.level(led_level)
}
