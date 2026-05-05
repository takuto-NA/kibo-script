// 責務: state machine が Idle/On を往復し、On の間だけ periodic task で LED を点滅させる最小 Pico サンプル（membership + elapsed 遷移）。

ref lamp = led#0

state ui every 100ms initial ui.Idle {
  Idle {
    on ui.Idle.elapsed >= 300 -> ui.On
  }
  On {
    on ui.On.elapsed >= 300 -> ui.Idle
  }
}

task show_idle in ui.Idle every 100ms {
  do lamp.off()
}

task pulse_on in ui.On every 100ms {
  do lamp.toggle()
}
