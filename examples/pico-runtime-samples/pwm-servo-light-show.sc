// 責務: PWM、motor、servo の出力値をモードで切り替え、LED と trace で状態遷移を確認する。

ref status_led = led#0
var show_mode = "dim"
var pwm_level = 20
var motor_power = 0
var servo_angle = 60

task light_show every 180ms {
  match show_mode {
    "dim" => {
      set pwm_level = 20
      set motor_power = 0
      set servo_angle = 60
      set show_mode = "sweep"
      do status_led.off()
    }
    "sweep" => {
      set pwm_level = 80
      set motor_power = 15
      set servo_angle = 120
      set show_mode = "flash"
      do status_led.toggle()
    }
    else => {
      set pwm_level = 100
      set motor_power = -10
      set servo_angle = 90
      set show_mode = "dim"
      do status_led.on()
    }
  }

  do pwm#0.level(pwm_level)
  do motor#0.power(motor_power)
  do servo#0.angle(servo_angle)
}
