// 責務: ボタンイベントでモードを循環し、周期タスクが現在モードを表示へ反映する。

ref status_led = led#0
var selected_mode = "idle"
var mode_changes = 0

task cycle_mode on button#0.pressed {
  match selected_mode {
    "idle" => {
      set selected_mode = "scan"
    }
    "scan" => {
      set selected_mode = "warn"
    }
    else => {
      set selected_mode = "idle"
    }
  }
  set mode_changes = mode_changes + 1
}

task render_mode every 150ms {
  match selected_mode {
    "warn" => {
      do status_led.on()
      do display#0.clear()
      do display#0.text(0, 0, "WARN")
      do display#0.circle(96, 32, 10)
      do display#0.present()
    }
    "scan" => {
      do status_led.toggle()
      do display#0.clear()
      do display#0.text(0, 0, "SCAN")
      do display#0.circle(64, 32, 6)
      do display#0.present()
    }
    else => {
      do status_led.off()
      do display#0.clear()
      do display#0.text(0, 0, "IDLE")
      do display#0.circle(24, 32, 4)
      do display#0.present()
    }
  }
}
