// 責務: `match`（文字列 target）で LED と `mode` を更新する。

ref status_led = led#0
var mode = "off"

task match_led every 200ms {
  match mode {
    "off" => {
      do status_led.on()
      set mode = "on"
    }
    "on" => {
      do status_led.off()
      set mode = "off"
    }
    else => {
      do status_led.off()
    }
  }
}
