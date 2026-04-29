// 責務: 物理ローバーの「状態遷移」「出力反映」「スキャン/ログ」を分離したサンプル。

ref left_motor = motor#0
ref right_motor = motor#1
ref scanner = servo#0
ref hull_led = led#0
ref glow = pwm#0
ref imu = imu#0

const scanner_min_degrees = -70
const scanner_step_degrees = 5
const scanner_edge_degrees = 70
const cruise_power_percent = 58
const turn_left_power_percent = 38
const turn_right_power_percent = 62
const reverse_left_power_percent = -54
const reverse_right_power_percent = -28
const dim_glow_percent = 35%
const warning_glow_percent = 100%

const cruise_duration_ms = 1280
const turn_duration_ms = 1280
const reverse_duration_ms = 1280

state scanner_angle_degrees = scanner_min_degrees
state scanner_direction = 1
state glow_level = 0%
state glow_target = 35%

state left_power_target = 0
state right_power_target = 0
state warning_enabled = 0

animator glow_fade = ramp over 360ms ease ease_in_out

task patrol loop {
  set warning_enabled = 0
  set glow_target = dim_glow_percent
  set left_power_target = cruise_power_percent
  set right_power_target = cruise_power_percent
  wait cruise_duration_ms ms

  set left_power_target = turn_left_power_percent
  set right_power_target = turn_right_power_percent
  wait turn_duration_ms ms

  set warning_enabled = 1
  set glow_target = warning_glow_percent
  set left_power_target = reverse_left_power_percent
  set right_power_target = reverse_right_power_percent
  wait reverse_duration_ms ms
}

task apply_outputs every 32ms {
  if warning_enabled != 0 {
    do hull_led.on()
  } else {
    do hull_led.off()
  }

  do left_motor.power(left_power_target)
  do right_motor.power(right_power_target)
}

task scan_and_report every 32ms {
  temp next_scanner_angle_degrees = scanner_angle_degrees + scanner_direction * scanner_step_degrees
  set scanner_angle_degrees = next_scanner_angle_degrees

  if scanner_angle_degrees > scanner_edge_degrees {
    set scanner_direction = -1
  } else {
    set scanner_direction = scanner_direction
  }

  if scanner_angle_degrees < scanner_min_degrees {
    set scanner_direction = 1
  } else {
    set scanner_direction = scanner_direction
  }

  do scanner.angle(scanner_angle_degrees)

  set glow_level = step glow_fade with glow_target dt
  do glow.level(glow_level)

  temp yaw_mdeg = read imu#0.yaw
  do serial#0.println(yaw_mdeg)
}
