// 責務: 走行・サーボ・画面上のスキャン点を、1 つの方向状態から同期して動かす。

const scan_y = 30
const scan_radius = 5
const left_edge_x = 16
const right_edge_x = 112
ref status_led = led#0
var scan_x = left_edge_x
var scan_step = 8
var servo_angle = 45
var drive_power = 20

task rover_scan every 120ms {
  do motor#0.power(drive_power)
  do servo#0.angle(servo_angle)
  do display#0.clear()
  do display#0.text(0, 0, "ROVER")
  do display#0.circle(scan_x, scan_y, scan_radius)
  do display#0.present()

  temp next_scan_x = scan_x + scan_step
  if next_scan_x > right_edge_x {
    set scan_step = -8
    set servo_angle = 135
    set drive_power = 12
    set scan_x = right_edge_x
    do status_led.on()
  } else {
    set scan_x = next_scan_x
  }

  if next_scan_x < left_edge_x {
    set scan_step = 8
    set servo_angle = 45
    set drive_power = 20
    set scan_x = left_edge_x
    do status_led.off()
  }
}
