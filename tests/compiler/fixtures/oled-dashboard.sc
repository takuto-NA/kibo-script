var scan_x = 8
var pulse_radius = 3
var requested_mode = "sweep"

state oled every 100ms initial oled.Sweep {
  Sweep {
    on requested_mode == "pulse" -> oled.Pulse
  }

  Pulse {
    on requested_mode == "sweep" -> oled.Sweep
  }
}

task toggle_oled_mode on button#0.pressed {
  if requested_mode == "sweep" {
    set requested_mode = "pulse"
  } else {
    set requested_mode = "sweep"
  }
}

task oled_sweep_dashboard in oled.Sweep every 100ms {
  do display#0.clear()
  do display#0.line(0, 0, 127, 0)
  do display#0.line(0, 0, 0, 63)
  do display#0.line(127, 0, 127, 63)
  do display#0.line(0, 63, 127, 63)
  do display#0.line(0, 52, 127, 52)
  do display#0.circle(scan_x, 28, pulse_radius)
  do display#0.pixel(8, 56)
  do display#0.pixel(scan_x, 56)
  do display#0.present()

  if scan_x >= 120 {
    set scan_x = 8
  } else {
    set scan_x = scan_x + 8
  }
}

task oled_pulse_dashboard in oled.Pulse every 100ms {
  do display#0.clear()
  do display#0.line(0, 0, 127, 0)
  do display#0.line(0, 0, 0, 63)
  do display#0.line(127, 0, 127, 63)
  do display#0.line(0, 63, 127, 63)
  do display#0.line(0, 52, 127, 52)
  do display#0.line(48, 16, 80, 16)
  do display#0.line(48, 40, 80, 40)
  do display#0.line(48, 16, 48, 40)
  do display#0.line(80, 16, 80, 40)
  do display#0.circle(64, 28, pulse_radius)
  do display#0.pixel(8, 56)
  do display#0.pixel(64, 56)
  do display#0.present()

  if pulse_radius >= 10 {
    set pulse_radius = 3
  } else {
    set pulse_radius = pulse_radius + 1
  }
}
