// 責務: 中央の円の半径を広げ、式・var 更新・display fingerprint の一致を確認する。

const circle_x = 64
const circle_y = 32
const radius_step = 2
var circle_radius = 3

task grow_circle every 150ms {
  do display#0.clear()
  do display#0.circle(circle_x, circle_y, circle_radius)
  do display#0.present()
  set circle_radius = circle_radius + radius_step
}
