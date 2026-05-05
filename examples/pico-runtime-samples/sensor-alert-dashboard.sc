// 責務: ADC の値から警戒レベルを決め、LED と OLED 表示を同じ状態として更新する。

const alert_threshold = 700
const calm_circle_radius = 6
const alert_circle_radius = 12
ref status_led = led#0
var sensor_raw = 0
var alert_level = "calm"
var alert_count = 0

task sample_and_render every 200ms {
  temp latest_sensor_raw = read adc#0
  set sensor_raw = latest_sensor_raw
  if latest_sensor_raw > alert_threshold {
    set alert_level = "alert"
  } else {
    set alert_level = "calm"
  }

  match alert_level {
    "alert" => {
      do status_led.on()
      set alert_count = alert_count + 1
      do display#0.clear()
      do display#0.text(0, 0, "ALERT")
      do display#0.circle(64, 32, alert_circle_radius)
      do display#0.present()
    }
    else => {
      do status_led.off()
      do display#0.clear()
      do display#0.text(0, 0, "CALM")
      do display#0.circle(64, 32, calm_circle_radius)
      do display#0.present()
    }
  }
}
