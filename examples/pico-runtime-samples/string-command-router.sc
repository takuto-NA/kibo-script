// 責務: 文字列 command をルーティングし、表示・LED・状態カウンタを同じ分岐で更新する。

ref status_led = led#0
var command = "draw"
var command_count = 0

task route_command every 220ms {
  match command {
    "draw" => {
      do status_led.on()
      do display#0.clear()
      do display#0.text(0, 0, "DRAW")
      do display#0.circle(48, 32, 6)
      do display#0.present()
      set command = "blink"
    }
    "blink" => {
      do status_led.toggle()
      do display#0.clear()
      do display#0.text(0, 0, "BLINK")
      do display#0.circle(80, 32, 6)
      do display#0.present()
      set command = "idle"
    }
    else => {
      do status_led.off()
      do display#0.clear()
      do display#0.text(0, 0, "IDLE")
      do display#0.present()
      set command = "draw"
    }
  }
  set command_count = command_count + 1
}
