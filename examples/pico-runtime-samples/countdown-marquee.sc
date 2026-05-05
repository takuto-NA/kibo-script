// 責務: カウントダウンの状態と表示位置を、周期タスクだけで進める。

const start_count = 5
const marker_y = 40
const marker_radius = 4
var seconds_left = start_count
var marker_x = 16

task countdown_marquee every 250ms {
  do display#0.clear()
  do display#0.text(0, 0, "COUNT")
  do display#0.circle(marker_x, marker_y, marker_radius)
  do display#0.present()

  if seconds_left == 0 {
    set seconds_left = start_count
  } else {
    set seconds_left = seconds_left + -1
  }

  temp next_marker_x = marker_x + 12
  if next_marker_x > 112 {
    set marker_x = 16
  } else {
    set marker_x = next_marker_x
  }
}
