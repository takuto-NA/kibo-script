// 責務: 2 つの円を異なる速度で動かし、複数 var と複数 circle draw の一致を確認する。

const upper_circle_y = 22
const lower_circle_y = 42
const circle_radius = 5
const lead_step = 8
const trail_step = 4
var lead_circle_x = 10
var trail_circle_x = 44

task chase_circles every 100ms {
  do display#0.clear()
  do display#0.circle(lead_circle_x, upper_circle_y, circle_radius)
  do display#0.circle(trail_circle_x, lower_circle_y, circle_radius)
  do display#0.present()
  temp next_lead_circle_x = lead_circle_x + lead_step
  temp next_trail_circle_x = trail_circle_x + trail_step
  set lead_circle_x = next_lead_circle_x
  set trail_circle_x = next_trail_circle_x
}
