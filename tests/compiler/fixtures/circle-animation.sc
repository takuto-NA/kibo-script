var circle_x = 20

task move_circle every 100ms {
  do display#0.clear()
  do display#0.circle(circle_x, 32, 8)
  do display#0.present()
  set circle_x = circle_x + 4
}
