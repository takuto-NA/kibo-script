// 責務: OLED 上の円を一定速度で右へ動かし、display fingerprint と `circle_x` trace を比較する。

const circle_y = 32
const circle_radius = 6
const circle_step = 6
var circle_x = 12

task sweep_circle every 100ms {
  do display#0.clear()
  do display#0.circle(circle_x, circle_y, circle_radius)
  do display#0.present()
  set circle_x = circle_x + circle_step
}
