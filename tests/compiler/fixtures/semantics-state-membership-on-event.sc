// 責務: `task ... in state.path on ...` が membership 外では動かないことを trace で確定する。

ref status_led = led#0

state sm every 100ms initial sm.Off {
  Off {
    on sm.Off.elapsed >= 100 -> sm.On
  }
  On {
  }
}

task toggle_when_on in sm.On on button#0.pressed {
  do status_led.toggle()
}
