// 責務: シリアル出力、LED、OLED を同じ heartbeat 状態から更新する。

ref status_led = led#0
ref debug_port = serial#0
var heartbeat_state = "low"
var heartbeat_count = 0

task heartbeat_log every 300ms {
  match heartbeat_state {
    "low" => {
      do debug_port.println("heartbeat high")
      do status_led.on()
      do display#0.clear()
      do display#0.text(0, 0, "HIGH")
      do display#0.circle(64, 32, 10)
      do display#0.present()
      set heartbeat_state = "high"
    }
    else => {
      do debug_port.println("heartbeat low")
      do status_led.off()
      do display#0.clear()
      do display#0.text(0, 0, "LOW")
      do display#0.circle(64, 32, 4)
      do display#0.present()
      set heartbeat_state = "low"
    }
  }
  set heartbeat_count = heartbeat_count + 1
}
