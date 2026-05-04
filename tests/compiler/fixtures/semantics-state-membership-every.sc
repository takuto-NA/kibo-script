// 責務: `task ... in state.path every` が membership 外では動かないことを trace で確定する。

ref status_led = led#0
var ticks_in_on = 0

state sm every 100ms initial sm.Off {
  Off {
    on sm.Off.elapsed >= 100 -> sm.On
  }
  On {
  }
}

task bump_ticks in sm.On every 100ms {
  set ticks_in_on = ticks_in_on + 1
  do status_led.toggle()
}
